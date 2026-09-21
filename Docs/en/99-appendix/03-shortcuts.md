# Keyboard Shortcuts

> A complete reference for the shortcuts available in the system — designed for fast keyboard-only work without the mouse, especially in POS.

## Quick Summary

| Shortcut | Context | Function |
|---|---|---|
| `Ctrl + K` | All pages | Open/close the Command Palette |
| `Ctrl + Shift + K` | All pages | Open/close the "Maghz" AI Assistant floating chat |
| `F2` | POS screen | Focus the search/barcode field and select its text |
| `F9` | POS screen | Open the payment screen (complete the sale) |
| `F10` | POS screen | Hold the current cart as a draft with a time-stamped name |
| `Enter` | Search fields | Execute the search / add the selected item |
| `↑` / `↓` | Command Palette | Navigate between results |
| `Enter` | Command Palette | Open the selected page/option |
| `Escape` | Windows and menus | Close the open window/menu/chat |

## POS (Cashier Screen)

POS is the most shortcut-rich screen, because it is designed for one-handed cashier work on the keyboard:

| Shortcut | Function | Details |
|---|---|---|
| `F2` | **Focus the search** | Jumps you straight to the search/barcode field and selects the previous text — type the barcode or product name immediately |
| `F9` | **Payment** | Opens the payment screen to complete the sale (cash/credit/mixed) |
| `F10` | **Hold the cart** | Holds the current cart as a draft with an automatic name such as «سلة 14:32» ("Cart 14:32") — useful when a customer is waiting and you start serving another; restore it from the held carts list |
| `Enter` (in the search field) | **Scan a barcode** | Adds the matching item to the cart directly — a barcode scanner behaves as if it types the code and ends with Enter |

A full cashier scenario without a mouse:

1. `F2` ← scan the barcode (or type the name and press Enter) — repeat for every item.
2. `F9` ← enter the amount received and confirm the payment.
3. After printing: `F2` again for the next customer. When it gets crowded, use `F10` to hold the waiting customers' carts.

## Command Palette

The fastest way to reach any page in the system:

| Key | Function |
|---|---|
| `Ctrl + K` (or `Cmd + K` on Mac) | Open the palette from any page — pressing it again closes it |
| `↑` / `↓` | Navigate the suggested pages (results ranked by the text typed) |
| `Enter` | Open the selected page |
| `Escape` | Close the palette |

For example, type «فواتير» ("invoices") and the relevant invoice pages are suggested — the palette contains every system page grouped by its section, and it is also an excellent way to discover pages you did not know existed.

## The "Maghz" AI Assistant

| Key | Function |
|---|---|
| `Ctrl + Shift + K` | Open/close the floating chat over the current page |
| `Escape` | Close the floating chat (unless the cursor is inside the text field — so you do not lose your draft) |
| `Enter` (in the chat field) | Send the message |

> Note the difference: `Ctrl + K` is for the Command Palette, while the floating chat requires adding `Shift` — the intent is to keep the two tools separate so they do not both spring open together.

## Popups and Menus

| Key | Function |
|---|---|
| `Escape` | Close any open popup (modal) — one window only, the deepest first |
| `Escape` | Close dropdown action menus (such as the print/export buttons menu) |
| `Escape` | Close the floating panel or the Command Palette, whichever is open |

## Conflict & Protection Rules

- The POS shortcuts (`F2`/`F9`/`F10`) work only inside the cashier screen — they have no effect outside it.
- `Ctrl + K` and `Ctrl + Shift + K` are deliberately separate: pressing one does not open the other, so layers never pile up on top of each other.
- The Command Palette and the floating chat are never open together — pressing the second shortcut is handled by single-toggle logic.
- Inside multi-line text fields (such as the chat), typing comes first: `Enter` sends, while `Escape` does not clear what you wrote.

## General Notes

- The shortcuts work in both web and desktop modes alike, and are written in Windows/Linux style (`Ctrl`) — on Mac use `Cmd` instead of `Ctrl`.
- The `F9`/`F10` shortcuts may conflict with operating system functions on some laptops (such as brightness or volume controls) — enable "Fn Lock" or use the equivalent on-screen buttons.
- All shortcuts work identically with an Arabic or English keyboard layout, because they are function keys, not letters.

## Quick Questions

| Question | Answer |
|---|---|
| Pressed `Ctrl + K` and the chat did not open? | This is correct behavior — `Ctrl + K` is for the Command Palette; the chat opens with `Ctrl + Shift + K` |
| Focus was lost on the cashier screen after a popup? | Press `Escape` to close it, then `F2` to return to the search field |
| `F10` held a cart and now I cannot see it? | Open the held carts list on the cashier screen and restore it — it is not deleted automatically |
| Are there shortcuts for barcode entry? | No special shortcut is needed: the scanner types into the search field and ends with `Enter` automatically |

## Tips

- Memorize just three to stay fast: `Ctrl + K` for navigation, `F2`/`F9` at the cashier, and `Ctrl + Shift + K` to ask "Maghz".
- Train a new cashier on the "scan ← F9 ← confirm" path before their first independent shift.
- Make `Ctrl + K` your first habit: it is faster than navigating menus, and it introduces you to every page in the system.
