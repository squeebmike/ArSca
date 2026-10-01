# Whatnot Live Stickers

Prints a sticker the moment a sale happens on your Whatnot live show:
**@buyer**, the item, the price and the time -- nothing to type. Stick it on
the thing they bought.

It reads your own show page in Chrome the way you would: the
"*name* **won!**" line with the item card under it, "*name* **won the
giveaway!**", and Buy It Now wording. It does not log in for you, place bids
or change anything on Whatnot.

## Set up once

1. In the dashboard's **Whatnot** tab, click **DOWNLOAD EXTENSION** and unzip
   it to a folder you'll keep (for example Documents\Whatnot Live Stickers).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick that folder.
3. Plug the MUNBYN into this computer and install its driver. In Windows
   **Printers & scanners** (Mac: **Printers & Scanners**), make the MUNBYN the
   **default printer** and set its paper/label size to **2 x 1 in** (50.8 x
   25.4 mm), or whatever size you pick in the extension.
4. **Print with no dialog:** make a Chrome shortcut that starts Chrome with
   `--kiosk-printing`.
   - Windows: right-click your Chrome shortcut > Properties > Target, add
     ` --kiosk-printing` after `chrome.exe"`, and close every Chrome window
     before using the shortcut.
   - Mac: in Terminal,
     `open -a "Google Chrome" --args --kiosk-printing` (quit Chrome first).
   Without this, each sticker opens Chrome's print preview and you click
   Print.
5. Click the extension's icon, then **TEST PRINT**. You should get a test
   sticker.

## During a show

Open your show on whatnot.com in that Chrome (watching your own stream works
-- you can still run the show from your phone). Leave the tab open. Each
sale prints one sticker. The extension's popup lists every sale with
**REPRINT**, and **EXPORT CSV** saves the show's sales.

- A page reload never reprints a result that was already on screen.
- The same buyer winning the same title twice prints twice, as long as the
  next item started in between.
- Turn off giveaway stickers, or switch to 3x2 / 4x6 labels, in the popup.

## If a sale doesn't print

Whatnot can change its page wording. When a sale shows on screen but no
sticker prints (Buy It Now especially), click **CAPTURE PAGE** in the popup
right then. It copies what the page says; paste that to Claude to update the
detection.
