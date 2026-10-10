<?php
declare(strict_types=1);
require_once dirname(__DIR__, 3) . '/server/api/bootstrap.php';
use BeyndaCalculator\Archive\QuoteArchive;
use BeyndaCalculator\QuoteApi\{QuoteService, QuoteCalculator, QuotePdfRenderer, IdempotencyStore, ApiException};
use BeyndaCalculator\Mail\{MailTransport, MailMessage};
function verify(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$dir = sys_get_temp_dir() . '/quote-edit-' . bin2hex(random_bytes(8));
$config = json_decode(file_get_contents(dirname(__DIR__, 3) . '/storage/config.json'), true);
$config['tariffs']['materials']['clear-pvc-700'] = 1000;
$request = ['project' => ['version'=>1,'products'=>[[
  'id'=>'window-1','type'=>'window','shape'=>'rectangle','position'=>'right',
  'dimensions'=>['width'=>100,'height'=>100], 'material'=>'clear-pvc-700','purpose'=>'opening',
  'hardware'=>'grommet','hardwareBySide'=>['top-1'=>[],'right-2'=>[],'bottom-3'=>[],'left-4'=>[]],
  'installation'=>['mode'=>'top','edgeOffsetCm'=>10,'spacingCm'=>30,'replaceTopWithGrommets'=>false],
  'border'=>['widthCm'=>10,'color'=>'white'],'extras'=>['weightBar'=>false,'flashing'=>false]
]]], 'contact'=>['name'=>'Test quote','phone'=>'+7 000 000-00-00','email'=>'test@example.test','consent'=>true], 'honeypot'=>''];
$mail = new class implements MailTransport {
 public array $sent=[]; public bool $fail=false;
 public function send(MailMessage $message): void { if ($this->fail && $message->recipientKind === 'client') throw new RuntimeException('test failure'); $this->sent[]=$message; }
};
try {
 $archive = new QuoteArchive($dir . '/archive');
 $service = new QuoteService(new QuoteCalculator(), new QuotePdfRenderer(), $mail, new IdempotencyStore($dir . '/keys.json', str_repeat('s',32)), $archive);
 $original = $service->deliver($request,$config,'create-test-00000001');
 $number = $original['quoteNumber']; $record=$archive->record($number); $oldPdf=$archive->pdf($number)['bytes'];
 $request['project']['products'][0]['dimensions']['width']=200;
 $saved=$service->edit($request,$config,'save-test-000000001',$number,$record['editToken'],false);
 verify(count($mail->sent)===2,'save sent mail');
 verify($saved['quoteNumber']===$number && count($archive->search(''))===1,'duplicate record');
 verify($archive->pdf($number)['bytes']!==$oldPdf,'PDF not replaced');
 verify($archive->record($number)['expiresAt']===$record['expiresAt'],'retention changed');
 verify($archive->record($number)['project']['products'][0]['dimensions']['width']===200,'project not replaced');
 verify($service->edit($request,$config,'save-test-000000001',$number,$record['editToken'],false)===$saved,'retry changed result');
 try { $service->edit($request,$config,'stale-test-00000001',$number,$record['editToken'],false); throw new RuntimeException('stale write allowed'); }
 catch (ApiException $error) { verify($error->errorCode==='EDIT_CONFLICT','wrong conflict'); }
 $mail->fail=true; $token=$saved['editToken'];
 try { $service->edit($request,$config,'send-test-000000001',$number,$token,true); throw new RuntimeException('failure not raised'); }
 catch (ApiException $error) { verify($error->errorCode==='EDIT_RETRY_REQUIRED','retry error'); }
 $mail->fail=false;
 $service->edit($request,$config,'send-test-000000001',$number,$token,true);
 verify(count($mail->sent)===4,'retry duplicated company mail');
 verify(count(glob($dir.'/archive/*.pdf'))===1,'multiple PDFs');
 try { $archive->savePrepared($request,$original['quote'],$oldPdf,$number.'.pdf'); throw new RuntimeException('original retry overwrote edit'); }
 catch (RuntimeException $error) { verify($error->getMessage()!=='original retry overwrote edit','original retry overwrote edit'); }
 echo "ARCHIVE_EDIT_OK\n";
} finally {
 $cleanup = function ($path) use (&$cleanup) { if (!is_dir($path)) return; foreach (new DirectoryIterator($path) as $f) { if ($f->isDot()) continue; $f->isDir() ? $cleanup($f->getPathname()) : unlink($f->getPathname()); } rmdir($path); };
 $cleanup($dir);
}
