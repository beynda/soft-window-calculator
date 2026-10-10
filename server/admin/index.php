<?php

declare(strict_types=1);

use BeyndaCalculator\Config\ConfigValidationException;
use function BeyndaCalculator\Admin\adminAuth;
use function BeyndaCalculator\Admin\applySecurityHeaders;
use function BeyndaCalculator\Admin\clientIdentifier;
use function BeyndaCalculator\Config\loadConfig;
use function BeyndaCalculator\Config\saveConfig;

require_once __DIR__ . '/bootstrap.php';

BeyndaCalculator\Admin\AdminAuth::startSession();
applySecurityHeaders();
$auth = adminAuth();
$error = null;
$notice = null;
$editorJson = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
    try {
        $auth->assertCsrf(is_string($_POST['csrf'] ?? null) ? $_POST['csrf'] : null);
        if ($action === 'login') {
            $identifier = clientIdentifier();
            $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
            if ($auth->login($password, $identifier)) {
                header('Location: ./', true, 303);
                exit;
            }
            $retryAfter = $auth->retryAfter($identifier);
            $error = $retryAfter > 0
                ? 'Too many attempts. Try signing in later.'
                : 'Incorrect password.';
        } elseif (!$auth->isAuthenticated()) {
            http_response_code(401);
            $error = 'Sign-in required.';
        } elseif ($action === 'logout') {
            $auth->logout();
            header('Location: ./', true, 303);
            exit;
        } elseif ($action === 'save') {
            $editorJson = is_string($_POST['config'] ?? null) ? $_POST['config'] : '';
            if (strlen($editorJson) > 262144) {
                throw new \RuntimeException('Configuration exceeds the size limit.');
            }
            $decoded = json_decode($editorJson, true, 64, JSON_THROW_ON_ERROR);
            if (!is_array($decoded) || array_is_list($decoded)) {
                throw new \RuntimeException('Configuration root must be JSON-an object.');
            }
            saveConfig($decoded);
            header('Location: ./?saved=1', true, 303);
            exit;
        } elseif ($action === 'save_form') {
            $current = loadConfig();
            $number = static function (string $key, float|int $fallback = 0): float|int {
                $value = $_POST[$key] ?? $fallback;
                return is_numeric($value) ? (float) $value : $fallback;
            };
            $current['companyAddress'] = is_string($_POST['companyAddress'] ?? null) ? trim($_POST['companyAddress']) : ($current['companyAddress'] ?? '');
            $current['ranges']['dimensions']['min'] = $number('dimensionMin', $current['ranges']['dimensions']['min']);
            $current['ranges']['dimensions']['max'] = $number('dimensionMax', $current['ranges']['dimensions']['max']);
            $current['ranges']['dimensions']['minSegment'] = $number('minSegment', $current['ranges']['dimensions']['minSegment']);
            $current['ranges']['borderWidthCm']['min'] = $number('borderMin', $current['ranges']['borderWidthCm']['min']);
            $current['ranges']['borderWidthCm']['max'] = $number('borderMax', $current['ranges']['borderWidthCm']['max']);
            foreach (['clear-pvc-700', 'tinted-pvc-700', 'none'] as $material) $current['tariffs']['materials'][$material] = $number("material_$material", $current['tariffs']['materials'][$material] ?? 0);
            unset($current['tariffs']['border']);
            foreach (['grommet', 'plastic-turn-button', 'metal-turn-button', 'black-metal-turn-button', 'strap-bracket-45', 'hook-strap-kit'] as $hardware) $current['tariffs']['hardware'][$hardware] = $number("hardware_$hardware", $current['tariffs']['hardware'][$hardware] ?? 0);
            foreach (['zipperPerMeter', 'weightBarPerMeter', 'flashingPerMeter'] as $tariff) $current['tariffs'][$tariff] = $number($tariff, $current['tariffs'][$tariff] ?? 0);
            $current['vat']['mode'] = ($_POST['vatMode'] ?? 'off') === 'included' ? 'included' : 'off';
            $current['vat']['ratePercent'] = $number('vatRate', $current['vat']['ratePercent'] ?? 0);
            $current['availableOptions']['materials'] = array_values(array_intersect(['clear-pvc-700', 'tinted-pvc-700', 'none'], is_array($_POST['materials'] ?? null) ? $_POST['materials'] : []));
            $current['availableOptions']['hardware'] = array_values(array_intersect(['grommet', 'plastic-turn-button', 'metal-turn-button', 'black-metal-turn-button', 'strap-bracket-45', 'hook-strap-kit'], is_array($_POST['hardware'] ?? null) ? $_POST['hardware'] : []));
            saveConfig($current);
            header('Location: ./?saved=1', true, 303);
            exit;
        }
    } catch (ConfigValidationException $exception) {
        $error = implode(' ', array_map(
            static fn (string $field, string $message): string => "$field: $message",
            array_keys($exception->errors()),
            array_values($exception->errors()),
        ));
    } catch (\JsonException) {
        $error = 'JSON contains a syntax error.';
    } catch (\Throwable) {
        $error = 'Operation rejected. Refresh the page and try again.';
    }
}

$authenticated = $auth->isAuthenticated();
$config = null;
if ($authenticated) {
    try {
        $config = loadConfig();
        if ($editorJson === null) {
            $editorJson = json_encode($config, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        if (($_GET['saved'] ?? null) === '1') {
            $notice = 'Configuration saved.';
        }
    } catch (\Throwable) {
        $error = 'Configuration could not be loaded. Check the server log.';
        $editorJson ??= '';
    }
}

require_once dirname(__DIR__) . '/config/Presentation.php';
$language = ($_GET['lang'] ?? $_COOKIE['beynda_language'] ?? 'en') === 'ru' ? 'ru' : 'en';
function tr(string $value): string { global $language; return \BeyndaCalculator\Config\presentText($value, ['language'=>$language, 'units'=>'cm']); }

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
?>
<!doctype html>
<html lang="<?= e($language) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= e(tr('Calculator settings')) ?></title>
  <style>
    body{font:16px/1.5 system-ui,sans-serif;max-width:1080px;margin:32px auto;padding:0 18px;color:#172033;background:#f5f7fa}
    main{background:#fff;border:1px solid #d9dfe8;border-radius:14px;padding:28px;box-shadow:0 6px 24px #17203312}
    h1{margin-top:0}h2{font-size:20px;margin:0 0 16px}.muted{color:#667085}.error{color:#9d1717;background:#fff0f0;padding:12px;border-radius:8px}.notice{color:#176b3a;background:#ecfff3;padding:12px;border-radius:8px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{border:1px solid #e1e6ed;border-radius:10px;padding:18px;background:#fbfcfe}.card.full{grid-column:1/-1}
    label{display:block;font-weight:600;margin-bottom:12px}label span{display:block;font-size:14px;font-weight:500;color:#475467;margin-bottom:5px}
    input,select{box-sizing:border-box;width:100%;padding:10px 11px;border:1px solid #b8c2d0;border-radius:7px;background:#fff;font:inherit}input[type=checkbox]{width:auto;margin:0 8px 0 0;accent-color:#1457d9}
    .checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.checks label{font-weight:500;margin:0;display:flex;align-items:center}
    button,a.button{display:inline-block;padding:10px 16px;border:0;border-radius:7px;background:#1457d9;color:#fff;text-decoration:none;cursor:pointer;font:inherit}.secondary{background:#667085!important}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:20px}
    .hint{font-size:13px;color:#667085;margin:-4px 0 12px}.required{color:#b42318}
    @media(max-width:700px){.grid,.checks{grid-template-columns:1fr}main{padding:20px}}
  </style>
</head>
<body><main>
  <h1><?= e(tr('Calculator settings')) ?></h1>
  <?php if ($error !== null): ?><p class="error"><?= e(tr($error)) ?></p><?php endif; ?>
  <?php if ($notice !== null): ?><p class="notice"><?= e(tr($notice)) ?></p><?php endif; ?>
  <?php if (!$authenticated): ?>
    <form method="post" autocomplete="off">
      <input type="hidden" name="action" value="login">
      <input type="hidden" name="csrf" value="<?= e($auth->csrfToken()) ?>">
      <p><label><?= e(tr('Password')) ?><br><input type="password" name="password" required autocomplete="current-password"></label></p>
      <button type="submit"><?= e(tr('Sign in')) ?></button>
    </form>
  <?php else: ?>
    <p class="muted"><?= e(tr('Last saved: ')) ?><?= e(is_string($config['savedAt'] ?? null) ? $config['savedAt'] : 'not saved yet') ?></p>
    <p class="muted"><?= e(tr('Quote recipient: quotes@example.invalid (is fixed and cannot be edited).')) ?></p>
    <form method="post">
      <input type="hidden" name="action" value="save_form">
      <input type="hidden" name="csrf" value="<?= e($auth->csrfToken()) ?>">
      <div class="grid">
        <section class="card">
          <h2><?= e(tr('General settings')) ?></h2>
          <label><span><?= e(tr('Company address')) ?></span><input name="companyAddress" value="<?= e((string)($config['companyAddress'] ?? '')) ?>" placeholder="Optional"></label>
          <label><span><?= e(tr('Tax')) ?></span><select name="vatMode"><option value="off"<?= (($config['vat']['mode'] ?? 'off') === 'off') ? ' selected' : '' ?>><?= e(tr('No VAT')) ?></option><option value="included"<?= (($config['vat']['mode'] ?? '') === 'included') ? ' selected' : '' ?>><?= e(tr('VAT included in price')) ?></option></select></label>
          <label><span><?= e(tr('VAT rate, %')) ?></span><input type="number" name="vatRate" min="0" max="100" step="0.01" value="<?= e((string)($config['vat']['ratePercent'] ?? 0)) ?>"></label>
        </section>
        <section class="card">
          <h2><?= e(tr('Dimensions and edging')) ?></h2>
          <div class="grid">
            <label><span><?= e(tr('Minimum dimension, cm')) ?></span><input type="number" name="dimensionMin" min="1" step="1" value="<?= e((string)($config['ranges']['dimensions']['min'] ?? 20)) ?>"></label>
            <label><span><?= e(tr('Maximum dimension, cm')) ?></span><input type="number" name="dimensionMax" min="1" max="1500" step="1" value="<?= e((string)($config['ranges']['dimensions']['max'] ?? 1500)) ?>"></label>
            <label><span><?= e(tr('Minimum segment, cm')) ?></span><input type="number" name="minSegment" min="1" step="1" value="<?= e((string)($config['ranges']['dimensions']['minSegment'] ?? 5)) ?>"></label>
            <label><span><?= e(tr('Minimum edging width, cm')) ?></span><input type="number" name="borderMin" min="1" step="1" value="<?= e((string)($config['ranges']['borderWidthCm']['min'] ?? 7)) ?>"></label>
            <label><span><?= e(tr('Maximum edging width, cm')) ?></span><input type="number" name="borderMax" min="1" step="1" value="<?= e((string)($config['ranges']['borderWidthCm']['max'] ?? 15)) ?>"></label>
          </div>
        </section>
        <section class="card">
          <h2><?= e(tr('Materials including edging, ₽ per m²')) ?></h2>
          <p class="hint"><?= e(tr('Each material price includes edging.')) ?></p>
          <label><span><?= e(tr('Clear PVC film, 700 microns')) ?></span><input type="number" name="material_clear-pvc-700" min="0" step="0.01" value="<?= e((string)($config['tariffs']['materials']['clear-pvc-700'] ?? 0)) ?>"></label>
          <label><span><?= e(tr('Tinted PVC film, 700 microns')) ?></span><input type="number" name="material_tinted-pvc-700" min="0" step="0.01" value="<?= e((string)($config['tariffs']['materials']['tinted-pvc-700'] ?? 0)) ?>"></label>
          <label><span><?= e(tr('Tarpaulin instead of PVC film')) ?></span><input type="number" name="material_none" min="0" step="0.01" value="<?= e((string)($config['tariffs']['materials']['none'] ?? 0)) ?>"></label>
        </section>
        <section class="card">
          <h2><?= e(tr('Hardware, ₽')) ?></h2>
          <?php $hardwareLabels = ['grommet'=>'Grommets - per piece','plastic-turn-button'=>'Plastic turn button - per piece','metal-turn-button'=>'Metal turn button - per piece','black-metal-turn-button'=>'Black metal turn button - per piece','strap-bracket-45'=>'Bracket and strap - per piece','hook-strap-kit'=>'Hook and strap - per kit']; foreach ($hardwareLabels as $key => $label): ?>
            <label><span><?= e($label) ?></span><input type="number" name="hardware_<?= e($key) ?><?= e(tr('" min="0" step="0.01" value="')) ?><?= e((string)($config['tariffs']['hardware'][$key] ?? 0)) ?>"></label>
          <?php endforeach; ?>
        </section>
        <section class="card">
          <h2><?= e(tr('Extra options, ₽')) ?></h2>
          <label><span><?= e(tr('Zipper - per meter')) ?></span><input type="number" name="zipperPerMeter" min="0" step="0.01" value="<?= e((string)($config['tariffs']['zipperPerMeter'] ?? 0)) ?>"></label>
          <label><span><?= e(tr('Weight bar - per meter')) ?></span><input type="number" name="weightBarPerMeter" min="0" step="0.01" value="<?= e((string)($config['tariffs']['weightBarPerMeter'] ?? 0)) ?>"></label>
          <label><span><?= e(tr('Bottom flashing - per meter')) ?></span><input type="number" name="flashingPerMeter" min="0" step="0.01" value="<?= e((string)($config['tariffs']['flashingPerMeter'] ?? 0)) ?>"></label>
        </section>
        <section class="card">
          <h2><?= e(tr('Available materials')) ?></h2>
          <p class="hint"><?= e(tr('Select the options that should be available in the calculator.')) ?></p>
          <?php $materials = ['clear-pvc-700'=>'Clear PVC film, 700 microns','tinted-pvc-700'=>'Tinted PVC film, 700 microns','none'=>'Tarpaulin instead of PVC film']; $enabledMaterials = $config['availableOptions']['materials'] ?? []; ?>
          <div class="checks"><?php foreach ($materials as $key => $label): ?><label><input type="checkbox" name="materials[]" value="<?= e($key) ?>"<?= in_array($key, $enabledMaterials, true) ? ' checked' : '' ?>><?= e($label) ?></label><?php endforeach; ?></div>
        </section>
        <section class="card full">
          <h2><?= e(tr('Available hardware')) ?></h2>
          <?php $enabledHardware = $config['availableOptions']['hardware'] ?? []; ?>
          <div class="checks"><?php foreach ($hardwareLabels as $key => $label): ?><label><input type="checkbox" name="hardware[]" value="<?= e($key) ?>"<?= in_array($key, $enabledHardware, true) ? ' checked' : '' ?>><?= e(preg_replace('/ - per (?:piece|kit)$/', '', $label)) ?></label><?php endforeach; ?></div>
        </section>
      </div>
      <p><button type="submit"><?= e(tr('Save settings')) ?></button></p>
    </form>
    <div class="row">
      <a class="button secondary" href="backup.php"><?= e(tr('Download configuration backup')) ?></a>
      <form method="post">
        <input type="hidden" name="action" value="logout">
        <input type="hidden" name="csrf" value="<?= e($auth->csrfToken()) ?>">
        <button type="submit"><?= e(tr('Sign out')) ?></button>
      </form>
    </div>
  <?php endif; ?>
</main></body>
</html>
