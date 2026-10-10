"""Real PHP archive authorization and browser editing, with isolated synthetic data."""
import os, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parents[2]
package = root / 'deployment/dist/window-calculator'
with tempfile.TemporaryDirectory(prefix='beynda-archive-auth-') as directory:
    temp = Path(directory)
    password = 'local-archive-test-password'
    password_hash = subprocess.check_output(['php', '-r', "echo password_hash('local-archive-test-password', PASSWORD_DEFAULT);"], text=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    env = dict(os.environ, ADMIN_PASSWORD_HASH=password_hash, ADMIN_RATE_LIMIT_PATH=str(temp/'login.json'), QUOTE_CONFIG_DIR=str(package/'storage'), QUOTE_RUNTIME_DIR=str(temp/'runtime'), QUOTE_ARCHIVE_DIR=str(temp/'archive'), QUOTE_MAIL_TRANSPORT='log', QUOTE_MAIL_LOG_PATH=str(temp/'mail.log'), QUOTE_IP_HASH_SALT='archive-test-ip-salt', QUOTE_IDEMPOTENCY_SALT='archive-test-idempotency-salt')
    server = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', str(package), str(package/'router.php')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(origin+'/config/public.php')
                break
            except OSError:
                time.sleep(.1)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page(viewport={'width':1440,'height':1000}, accept_downloads=True)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(origin+'/public/?lang=en&units=cm&currency=USD')
            page.locator('[data-archive-toggle]').click()
            expect(page.locator('[data-archive-status]')).to_contain_text('Sign in')
            expect(page.locator('[data-archive-status] a')).to_have_attribute('href', origin+'/admin/')
            page.locator('[data-archive-status] a').click()
            page.locator('[name="password"]').fill(password)
            page.get_by_role('button', name='Sign in', exact=True).click()
            expect(page.get_by_role('button', name='Sign out', exact=True)).to_be_visible()
            page.goto(origin+'/public/?lang=en&units=cm&currency=USD')
            form = page.locator('[data-quote-form]')
            for name, value in [('name','Synthetic Test'),('phone','+1 000 000 0000'),('email','archive-browser@example.test')]:
                form.locator(f'[name="{name}"]').fill(value)
            form.locator('[type="submit"]').click()
            expect(form.locator('[data-submission-status]')).to_contain_text('submitted', timeout=20000)
            page.locator('[data-archive-toggle]').click()
            card = page.locator('.wc-archive-card')
            expect(card).to_have_count(1)
            card.locator('summary').click()
            with page.expect_download() as download:
                card.locator('a').click()
            download.value.save_as(str(temp/'quote.pdf'))
            assert (temp/'quote.pdf').read_bytes().startswith(b'%PDF')
            card.locator('[data-archive-edit]').click()
            expect(form.locator('[name="email"]')).to_have_value('archive-browser@example.test')
            expect(form.locator('[data-edit-save]')).to_be_visible(timeout=5000)
            width = page.locator('[data-field-path="dimensions.width"]')
            width.fill('240')
            width.press('Tab')
            form.locator('[data-edit-save]').click()
            expect(form.locator('[data-submission-status]')).to_contain_text('saved', timeout=20000)
            assert len((temp/'mail.log').read_text().splitlines()) == 2
            card.locator('[data-archive-edit]').click()
            expect(width).to_have_value('240')
            page.goto(origin+'/admin/')
            page.get_by_role('button', name='Sign out', exact=True).click()
            assert page.request.get(origin+'/archive/').status == 401
            assert not errors, errors
            browser.close()
            print('ARCHIVE_AUTH_BROWSER_OK')
    finally:
        server.terminate()
        server.wait(timeout=5)
