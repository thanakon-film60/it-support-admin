from pathlib import Path
import argparse, json, re, zipfile, xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright

out=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--audience', choices=['users', 'it'])
args=parser.parse_args()
stem='IT-Support-Manual-TH'
if args.audience:
    from split_content import GUIDES
    stem=GUIDES[args.audience][0]
    out=out/args.audience
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    page=browser.new_page(viewport={'width':1050,'height':1250},device_scale_factor=1)
    page.goto((out/f'{stem}.html').as_uri())
    page.evaluate('document.fonts.ready')
    page.wait_for_function('Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)')
    results=page.evaluate('''() => Array.from(document.querySelectorAll('.page')).map((p,i)=>({page:i+1,title:p.querySelector('h1').innerText,contentBottom:p.querySelector('main').getBoundingClientRect().bottom-p.getBoundingClientRect().top,footerTop:p.querySelector('.footer').getBoundingClientRect().top-p.getBoundingClientRect().top,overflow:p.querySelector('main').getBoundingClientRect().bottom>p.querySelector('.footer').getBoundingClientRect().top-8}))''')
    page.pdf(path=str(out/f'{stem}.pdf'),format='A4',print_background=True,prefer_css_page_size=True,display_header_footer=False)
    for n in sorted(set([1,2,4,7,len(results)] + ([13,17,21,27] if not args.audience else []))):
        page.locator('.page').nth(n-1).screenshot(path=str(out/f'preview-{n:02}.png'))
    browser.close()
with zipfile.ZipFile(out/f'{stem}.docx') as z:
    for name in z.namelist():
        if name.endswith(('.xml','.rels')): ET.fromstring(z.read(name))
pdf=(out/f'{stem}.pdf').read_bytes()
report={'html_pages':len(results),'pdf_pages':len(re.findall(rb'/Type /Page\b',pdf)), 'overflow':[r for r in results if r['overflow']], 'docx_xml_valid':True, 'layout':results}
(out/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='layout'},ensure_ascii=True))
