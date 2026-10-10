"""Static demo acceptance without server endpoints or customer data."""
from pathlib import Path
import http.server, threading, tempfile, os
from functools import partial
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parents[2]
server = http.server.ThreadingHTTPServer(('127.0.0.1',0), partial(http.server.SimpleHTTPRequestHandler,directory=str(root/'deployment/demo')))
threading.Thread(target=server.serve_forever,daemon=True).start()
artifacts = Path(os.environ.get('CALCULATOR_TEST_ARTIFACTS',tempfile.mkdtemp(prefix='beynda-demo-')))
artifacts.mkdir(parents=True,exist_ok=True)
try:
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(channel='chrome',headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
        errors=[];requests=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.on('request',lambda request: requests.append((request.method,request.url)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        width=page.locator('[data-field-path="dimensions.width"]')
        expect(width).to_be_visible()
        assert page.locator('[data-quote-form], [data-quote-archive], input[type="email"], input[type="tel"]').count()==0
        width.fill('50');width.press('Tab')
        page.screenshot(path=str(artifacts/'calculator-demo-en.png'),full_page=True)
        with page.expect_download() as download: page.locator('[data-public-action="pdf"]').click()
        download.value.save_as(str(artifacts/'calculator-demo-en.pdf'))
        assert (artifacts/'calculator-demo-en.pdf').read_bytes().startswith(b'%PDF')
        page.locator('[data-preference="market"]').select_option('EUR')
        expect(page.locator('[data-preference="market"]')).to_have_value('EUR')
        page.locator('[data-preference="language"]').select_option('ru')
        expect(page.locator('html')).to_have_attribute('lang','ru')
        expect(page.locator('[data-preference="market"]')).to_have_value('RUB')
        expect(page.locator('[data-public-action="pdf"]')).to_be_enabled()
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(artifacts/'calculator-demo-ru-mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors,errors
        assert all(method=='GET' and ('/src/' in url or ('/api/' not in url and '/archive/' not in url)) for method,url in requests),requests
        browser.close()
        print('STATIC_DEMO_OK: en/in/USD, EUR, ru/cm/RUB, PDF, mobile, no contacts or backend requests')
finally:
    server.shutdown();server.server_close()
