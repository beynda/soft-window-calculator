"""Real PHP + browser edit flow. All storage/mail is isolated in a temporary directory."""
import os, json, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='quote-edit-e2e-') as temp:
    storage = Path(temp)
    config = json.loads((ROOT / 'storage/config.json').read_text(encoding='utf-8'))
    config['tariffs']['materials']['clear-pvc-700'] = 1000
    for key in config['tariffs']['hardware']: config['tariffs']['hardware'][key] = 20
    (storage / 'config.json').write_text(json.dumps(config), encoding='utf-8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    env = dict(os.environ, QUOTE_CONFIG_DIR=temp, QUOTE_RUNTIME_DIR=str(storage/'runtime'), QUOTE_ARCHIVE_DIR=str(storage/'archive'), QUOTE_MAIL_TRANSPORT='log', QUOTE_MAIL_LOG_PATH=str(storage/'mail.log'), QUOTE_IP_HASH_SALT='archive-test-ip-salt', QUOTE_IDEMPOTENCY_SALT='archive-test-idempotency-salt')
    server = subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t',str(ROOT/'deployment/dist/window-calculator')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try: urllib.request.urlopen(origin+'/config/public.php'); break
            except OSError: time.sleep(.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page(viewport={'width':1440,'height':1000})
            errors=[]; page.on('pageerror',lambda e: errors.append(str(e)))
            page.on('dialog',lambda d: d.accept())
            page.goto(origin+'/public/')
            form=page.locator('[data-quote-form]')
            for name,value in [('name','Edit test'),('phone','89000000000'),('email','edit@example.test')]: form.locator(f'[name="{name}"]').fill(value)
            expect(form.locator('[name="consent"]')).to_have_count(0)
            form.locator('[type="submit"]').click()
            expect(form.locator('[data-submission-status]')).to_contain_text('submitted',timeout=20000)
            page.locator('[data-archive-toggle]').click()
            card=page.locator('.wc-archive-card')
            expect(card).to_have_count(1)
            card.locator('summary').click()
            number=card.locator('[data-archive-edit]').get_attribute('data-archive-edit')
            expect(card.locator('[data-archive-save], [data-archive-send]')).to_have_count(0)
            expect(form.locator('[data-edit-save]')).to_be_hidden()
            card.locator('[data-archive-edit]').click()
            expect(form.locator('[type="submit"]')).to_have_text('Save and submit')
            expect(form.locator('[name="email"]')).to_have_value('edit@example.test')
            width=page.locator('[data-field-path="dimensions.width"]')
            width.fill('240'); width.press('Tab')
            form.get_by_role('button',name='Save',exact=True).click()
            expect(form.locator('[data-submission-status]')).to_have_text(f'Quote {number} saved.')
            assert len((storage/'mail.log').read_text().splitlines())==2
            card.locator('[data-archive-edit]').click()
            expect(width).to_have_value('240')
            expect(page.locator('[data-archive-status]')).to_contain_text('Quote opened')
            form.locator('[name="email"]').fill('updated@example.test')
            form.get_by_role('button',name='Save and submit',exact=True).click()
            expect(form.locator('[data-submission-status]')).to_have_text(f'Quote {number} saved and submitted.',timeout=20000)
            assert len((storage/'mail.log').read_text().splitlines())==4
            expect(card).to_have_count(1)
            assert card.locator('[data-archive-edit]').get_attribute('data-archive-edit')==number
            with page.expect_download() as download: card.get_by_text('Download PDF',exact=True).click()
            assert download.value.suggested_filename==number+'.pdf'
            # Populate only the isolated test archive to exercise multiple pages.
            database_path=storage/'archive/quotes.json'
            database=json.loads(database_path.read_text(encoding='utf-8'))
            assert database[number]['contact']['email']=='updated@example.test'
            template=database[number]
            for index in range(25):
                row=json.loads(json.dumps(template))
                key=f'Q-SEED-{index:03d}'
                row['quoteNumber']=key
                row['createdAt']='2026-01-01T00:00:00+00:00'
                row['contact']['name']='Unique old record' if index==0 else f'Manager {index}'
                database[key]=row
            database_path.write_text(json.dumps(database),encoding='utf-8')
            page.reload()
            page.locator('[data-archive-toggle]').click()
            expect(card).to_have_count(10)
            expect(page.locator('[data-archive-page="0"]')).to_be_disabled()
            page.get_by_role('button',name='Next',exact=True).click()
            expect(page.locator('.wc-archive__pagination')).to_contain_text('Page 2 of 3')
            expect(card).to_have_count(10)
            page.get_by_role('button',name='Next',exact=True).click()
            expect(page.locator('.wc-archive__pagination')).to_contain_text('Page 3 of 3')
            expect(card).to_have_count(6)
            expect(page.get_by_role('button',name='Next',exact=True)).to_be_disabled()
            search=page.get_by_role('searchbox',name='Search archive')
            search.fill('Unique old record')
            page.get_by_role('button',name='Search',exact=True).click()
            expect(card).to_have_count(1)
            expect(search).to_have_value('Unique old record')
            expect(page.locator('.wc-archive__pagination')).to_contain_text('Page 1 of 1')
            search.fill('')
            page.get_by_role('button',name='Search',exact=True).click()
            expect(card).to_have_count(10)
            expect(page.locator('details[open]')).to_have_count(0)
            page.locator('[data-quote-archive]').screenshot(path=str(ROOT/'output/archive-list-desktop.png'))
            page.set_viewport_size({'width':360,'height':800})
            card.first.locator('summary').click()
            expect(card.first.locator('[data-archive-edit]')).to_be_visible()
            page.locator('[data-quote-archive]').screenshot(path=str(ROOT/'output/archive-list-mobile.png'))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert not errors,errors
            browser.close()
            print('ARCHIVE_EDIT_E2E_OK: edit/save/send/PDF + pagination 26 records, global search, collapsed rows, desktop/mobile')
    finally:
        server.terminate(); server.wait(timeout=5)
