# Askly - shareable form (Google Sheets + GitHub Pages)

Files
- index.html, Form_CSS.css, Form_script.js, config.js  -> the website (push to GitHub)
- Code.gs -> NOT uploaded to GitHub. Paste into Google Sheet > Extensions > Apps Script

Setup
1. Create a Google Sheet. Extensions > Apps Script. Delete old code, paste Code.gs.
2. Change ADMIN_PASSWORD at the top. Save.
3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy, Authorize.
4. Copy the Web app URL and paste it in config.js (SCRIPT_URL).
5. Push the website files to GitHub, then Settings > Pages > Deploy from branch (main, root).
6. Open https://YOURNAME.github.io/REPO/ , log in with your password, Build Form, Copy link, share.
