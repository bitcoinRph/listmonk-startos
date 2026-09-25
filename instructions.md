# listmonk

## Documentation

- [listmonk documentation](https://listmonk.app/docs/): upstream guide to lists, subscribers, campaigns, templates, and settings.

## Getting set up

1. After install, run the **Get Admin Credentials** task. It shows the admin username (`admin`) and a generated password. Save the password in your password manager.
2. Start listmonk and open the **Web UI** address. The dashboard is at `/admin`.
3. Go to **Settings > General** and set **Root URL** to the address subscribers will use (for example `https://news.example.com`). Links in emails, opt-in confirmations, and unsubscribe links are built from this value, so it must be an address the public can reach.
4. Go to **Settings > SMTP** and add the mail server that will send your campaigns. Use **Test connection** before you save.
5. Send a test campaign to yourself before sending to a list.

## Before sending to real subscribers

- **Public address.** Subscribers open unsubscribe, opt-in, and archive links from their inbox, so the Web UI needs a public domain (clearnet), not only a LAN or Tor address.
- **Email authentication.** Set up SPF, DKIM, and DMARC DNS records for your sending domain. Without them, most campaigns land in spam.
- **Legal footer.** US law (CAN-SPAM) requires a physical mailing address and a working unsubscribe link in every commercial email. listmonk templates include the unsubscribe link by default; add your address to the template footer.
- **Double opt-in.** Create lists as **Double opt-in** so each subscriber confirms their address.

## Password

The password shown by **Get Admin Credentials** is the one listmonk was set up with. If you change it inside listmonk, the action keeps showing the old one; use your new password.

## Backups

StartOS backups include the full database (as a PostgreSQL dump), uploaded media, and the generated passwords.
