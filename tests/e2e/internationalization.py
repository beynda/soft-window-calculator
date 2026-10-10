from pathlib import Path
import subprocess, json, tempfile, os
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parents[2]
base = Path(os.environ.get('CALCULATOR_TEST_ARTIFACTS', tempfile.mkdtemp(prefix='beynda-calculator-ui-')))
base.mkdir(parents=True, exist_ok=True)
server = subprocess.Popen(['node','tests/e2e/dev-server.mjs','--port=0'],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
try:
    origin = server.stdout.readline().strip()
    if not origin: raise RuntimeError(server.stderr.read())
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome',headless=True)
        context = browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        page = context.new_page()
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(origin+'/public/')
        expect(page.locator('[data-field-path="dimensions.width"]')).to_be_visible()
        (base/'calculator-international-en-text.txt').write_text(page.locator('body').inner_text(),encoding='utf-8')
        page.screenshot(path=str(base/'calculator-international-en-desktop.png'),full_page=True)
        assert page.locator('html').get_attribute('lang')=='en'
        assert page.locator('[data-preference="market"]').input_value()=='USD'
        width=page.locator('[data-field-path="dimensions.width"]')
        assert abs(float(width.input_value())-120/2.54)<0.00001
        width.fill('50'); width.press('Tab')
        assert '127' in page.evaluate("localStorage.getItem('beynda-soft-window-calculator-draft')")
        with page.expect_download() as d: page.get_by_role('button',name='Download PDF',exact=True).click()
        d.value.save_as(str(base/'calculator-international-us.pdf'))
        page.locator('[data-preference="market"]').select_option('EUR')
        expect(page.locator('[data-field-path="dimensions.width"]')).to_be_visible()
        assert page.locator('[data-preference="market"]').input_value()=='EUR'
        page.locator('[data-preference="units"]').select_option('cm')
        expect(page.locator('[data-field-path="dimensions.width"]')).to_be_visible()
        assert abs(float(page.locator('[data-field-path="dimensions.width"]').input_value())-127)<0.0001
        page.locator('[data-preference="language"]').select_option('ru')
        expect(page.locator('html')).to_have_attribute('lang','ru')
        expect(page.locator('[data-field-path="dimensions.width"]')).to_be_visible()
        assert page.locator('[data-preference="market"]').input_value()=='RUB'
        assert page.locator('[data-preference="units"]').is_disabled()
        (base/'calculator-international-ru-text.txt').write_text(page.locator('body').inner_text(),encoding='utf-8')
        page.screenshot(path=str(base/'calculator-international-ru-desktop.png'),full_page=True)
        with page.expect_download() as d: page.locator('[data-public-action="pdf"]').click()
        d.value.save_as(str(base/'calculator-international-ru.pdf'))
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(base/'calculator-international-ru-mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors, errors
        browser.close()
    print('UI_OK: en/USD/in, EUR, metric roundtrip, ru/RUB/cm, two PDFs, desktop/mobile, no page errors')
finally:
    server.terminate(); server.wait(timeout=5)
