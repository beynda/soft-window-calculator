from io import BytesIO
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageChops
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect, sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
BASELINES = ROOT / "tests" / "e2e" / "baselines"
UPDATE_SNAPSHOTS = "--update-snapshots" in sys.argv
SNAPSHOT_MASKS = ["[data-quote-summary] .quote-summary__header"]  # Generated quote number/date only.
PIXEL_CHANNEL_TOLERANCE = 18
MAX_CHANGED_PIXEL_RATIO = 0.002


def main():
    server = subprocess.Popen(
        ["node", "tests/e2e/dev-server.mjs", "--port=0"], cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        url = server.stdout.readline().strip()
        if not url:
            raise RuntimeError(server.stderr.read() or "Local UI mock server did not start")
        with sync_playwright() as playwright:
            chrome = playwright.chromium.launch(channel="chrome", headless=True)
            run_flow(chrome, url, {"width": 1440, "height": 900}, "chrome-desktop")
            run_flow(chrome, url, {"width": 360, "height": 800}, "chrome-mobile-360")
            run_keyboard_only_flow(chrome, url)
            chrome.close()
            edge_result = run_edge_if_installed(playwright, url)
        print(f"E2E_UI_MOCK_OK chrome desktop+360 keyboard PDF privacy snapshots; {edge_result}")
        print("E2E_NOTE PHP production wiring is tested separately by built-package-php.test.js")
    finally:
        server.terminate()
        server.wait(timeout=5)


def run_flow(browser, origin, viewport, label):
    context = browser.new_context(viewport=viewport, accept_downloads=True, reduced_motion="reduce")
    page = context.new_page()
    console_messages = []
    request_urls = []
    page.on("console", lambda message: console_messages.append(message.text))
    page.on("request", lambda request: request_urls.append(request.url))
    page.goto(f"{origin}/public/?lang=en&units=cm&currency=USD", wait_until="networkidle")
    page.get_by_role("heading", name="Calculate your soft window panels").wait_for()
    assert_visual_snapshot(page, label)

    assert page.locator('[data-shape-id="rectangle"]').get_attribute("aria-pressed") == "true"
    assert page.locator(".wc-canvas svg polygon").count() >= 1
    canvas_box = page.locator(".wc-canvas").bounding_box()
    height_box = page.locator('[data-dimension-name="height"]').bounding_box()
    assert canvas_box and height_box
    assert height_box["y"] >= canvas_box["y"] + canvas_box["height"] + 8, (
        "dimension controls must stay below the schematic and never overlap it"
    )
    expect(page.locator('[data-action="select-side"]')).not_to_have_count(0)
    page.locator('.wc-segment-label[data-action="select-side"][data-side-id="top-1"]').click()
    page.locator('[data-hardware="grommet"]').check()
    page.locator('[data-hardware="plastic-turn-button"]').check()
    expect(page.locator(".wc-fastener--grommet")).not_to_have_count(0)
    expect(page.locator(".wc-fastener--plastic-turn-button")).not_to_have_count(0)
    expect(page.locator('.wc-fastener-position[data-hardware-count="2"]')).to_have_count(4)
    expect(page.locator(".wc-border-segment.is-selected")).to_have_count(0)
    expect(page.locator(".wc-segment-label-bg.is-selected")).to_have_count(1)
    page.locator('[data-shape-id="hexagon-peak"]').click()
    expect(page.locator('[data-field-path="dimensions.ridgeWidth"]')).to_be_visible()
    page.locator('[data-action="add"][data-product-type="door"]').click()
    expect(page.locator('[data-field-path="zipperMode"]')).to_be_visible()
    page.locator('[data-action="add"][data-product-type="door"]').click()
    page.locator('[data-action="add"][data-product-type="door"]').click()
    expect(page.locator(".wc-notice")).to_contain_text("at most 2 doors")
    for _ in range(9):
        page.locator('[data-action="add"][data-product-type="window"]').click()
    page.locator('[data-action="add"][data-product-type="window"]').click()
    expect(page.locator(".wc-notice")).to_contain_text("at most 10 windows")

    width = page.locator('[data-field-path="dimensions.width"]')
    width.fill("222")
    width.press("Tab")
    page.reload(wait_until="networkidle")
    expect(page.locator('[data-field-path="dimensions.width"]')).to_have_value("222")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

    pdf_button = page.locator('[data-public-action="pdf"]')
    expect(pdf_button).to_be_enabled()
    with page.expect_download() as download_info:
        pdf_button.click()
    assert_downloaded_pdf(download_info.value)

    pii = {"name": f"Test {label}", "phone": "+7 000 000 00 00", "email": f"{label}@example.test"}
    page.locator('[name="name"]').fill(pii["name"])
    page.locator('[name="phone"]').fill(pii["phone"])
    page.locator('[name="email"]').fill(pii["email"])
    expect(page.locator('[name="consent"]')).to_have_count(0)
    page.locator('[data-quote-form] [type="submit"]').click()
    expect(page.locator("[data-submission-status]")).to_contain_text("submitted")
    local_storage = page.evaluate("JSON.stringify(localStorage)")
    log_text = page.evaluate("fetch('/_test/logs').then(response => response.text())")
    for value in pii.values():
        assert value not in local_storage
        assert value not in log_text
        assert value not in page.url
        assert all(value not in message for message in console_messages)

    page.locator('[data-archive-toggle]').click()
    expect(page.locator('.wc-archive-card')).not_to_have_count(0)
    expect(page.locator('.wc-archive-card').first).to_contain_text(pii['email'])
    expect(page.locator('.wc-archive-card').first).to_contain_text('12 products')
    page.locator('.wc-archive-card').first.locator('summary').click()
    expect(page.locator('.wc-archive-card').first.get_by_role('link', name='Download PDF')).to_be_visible()
    expect(page.locator('.wc-archive-card').first.get_by_role('button', name='Edit')).to_be_enabled()

    page.route("**/api/quote/", lambda route: route.abort("failed"))
    page.locator('[data-quote-form] [type="submit"]').click()
    expect(page.locator("[data-submission-status]")).to_contain_text("could not be sent")
    expect(page.locator('[name="phone"]')).to_have_value(pii["phone"])
    expect(pdf_button).to_be_enabled()
    assert all(request_url.startswith(origin) or request_url.startswith("blob:") for request_url in request_urls)
    context.close()


def run_keyboard_only_flow(browser, origin):
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.goto(f"{origin}/public/?lang=en&units=cm&currency=USD", wait_until="networkidle")
    for preference in ('language', 'units', 'market'):
        assert tab_to(page, f'[data-preference="{preference}"]') == 1
    assert tab_to(page, '[data-action="reset"]') == 1
    assert_focused(page, '[data-action="reset"]')
    assert page.evaluate("getComputedStyle(document.activeElement).outlineWidth") != "0px"
    tab_to(page, '[data-action="add"][data-product-type="window"]')
    assert_focused(page, '[data-action="add"][data-product-type="window"]')
    page.keyboard.press("Enter")
    expect(page.locator(".wc-product-chip")).to_have_count(2)
    tab_to(page, '[data-action="add"][data-product-type="door"]')
    assert_focused(page, '[data-action="add"][data-product-type="door"]')
    page.keyboard.press("Enter")
    expect(page.locator('[data-field-path="zipperMode"]')).to_be_visible()
    tab_to(page, '[data-field-path="extras.flashing"]')
    assert_focused(page, '[data-field-path="extras.flashing"]')
    page.keyboard.press("Space")
    expect(page.locator('[data-field-path="extras.flashing"]')).to_be_checked()
    tab_to(page, '[name="name"]')
    assert_focused(page, '[name="name"]')
    page.keyboard.insert_text("Keyboard User")
    page.keyboard.press("Tab")
    assert_focused(page, '[name="phone"]')
    page.keyboard.insert_text("+7 000 000 00 00")
    page.keyboard.press("Tab")
    assert_focused(page, '[name="email"]')
    page.keyboard.insert_text("keyboard@example.test")
    page.keyboard.press("Tab")
    assert_focused(page, '[data-quote-form] [type="submit"]')
    page.keyboard.press("Enter")
    expect(page.locator("[data-submission-status]")).to_contain_text("submitted")
    context.close()


def tab_to(page, selector, limit=120):
    for count in range(1, limit + 1):
        page.keyboard.press("Tab")
        if page.evaluate("selector => document.activeElement?.matches(selector) === true", selector):
            return count
    raise AssertionError(f"Tab order never reached {selector}")


def assert_focused(page, selector):
    assert page.evaluate("selector => document.activeElement?.matches(selector) === true", selector), selector


def assert_downloaded_pdf(download):
    assert download.suggested_filename.endswith(".pdf")
    path = Path(download.path())
    data = path.read_bytes()
    assert data.startswith(b"%PDF-1.7")
    assert data.rstrip().endswith(b"%%EOF")
    assert b"startxref" in data and b"/Type /Catalog" in data and b"/Type /Page" in data
    reader = PdfReader(str(path), strict=True)
    assert len(reader.pages) >= 1
    first = reader.pages[0]
    assert round(float(first.mediabox.width)) == 595
    assert round(float(first.mediabox.height)) == 842
    metadata = reader.trailer["/Root"]["/Metadata"].get_object().get_data().decode("utf-8")
    for expected in ("Beynda", "Soft window", "Grand total"):
        assert expected in metadata, f"PDF catalog metadata missing: {expected}"


def assert_visual_snapshot(page, name):
    masks = [page.locator(selector) for selector in SNAPSHOT_MASKS]
    actual = page.screenshot(animations="disabled", caret="hide", mask=masks, mask_color="#ff00ff")
    baseline_path = BASELINES / f"{name}.png"
    if UPDATE_SNAPSHOTS:
        BASELINES.mkdir(parents=True, exist_ok=True)
        baseline_path.write_bytes(actual)
        return
    if not baseline_path.exists():
        raise AssertionError(f"Missing visual baseline: {baseline_path}; update intentionally with npm run test:e2e -- --update-snapshots")
    baseline = Image.open(baseline_path).convert("RGB")
    current = Image.open(BytesIO(actual)).convert("RGB")
    assert baseline.size == current.size, f"snapshot size changed for {name}: {baseline.size} != {current.size}"
    difference = ImageChops.difference(baseline, current)
    pixels = difference.get_flattened_data() if hasattr(difference, "get_flattened_data") else difference.getdata()
    changed = sum(1 for pixel in pixels if max(pixel) > PIXEL_CHANNEL_TOLERANCE)
    ratio = changed / (baseline.width * baseline.height)
    assert ratio <= MAX_CHANGED_PIXEL_RATIO, f"visual snapshot {name} changed by {ratio:.3%} (limit {MAX_CHANGED_PIXEL_RATIO:.3%})"


def run_edge_if_installed(playwright, origin):
    try:
        edge = playwright.chromium.launch(channel="msedge", headless=True)
    except PlaywrightError as error:
        if "Executable doesn't exist" in str(error) or "distribution" in str(error).lower():
            return "EDGE_SKIP not installed"
        raise
    try:
        for viewport in ({"width": 1440, "height": 900}, {"width": 360, "height": 800}):
            page = edge.new_page(viewport=viewport)
            page.goto(f"{origin}/public/?lang=en&units=cm&currency=USD", wait_until="networkidle")
            page.get_by_role("heading", name="Calculate your soft window panels").wait_for()
            assert page.locator(".wc-canvas svg polygon").count() >= 1
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.close()
    finally:
        edge.close()
    return "EDGE_OK desktop+360 launched"


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise
