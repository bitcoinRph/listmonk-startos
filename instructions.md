# listmonk

## Documentation

- [listmonk documentation](https://listmonk.app/docs/): upstream guide to lists, subscribers, campaigns, templates, and settings.

## Getting set up

1. Start listmonk and open the **Web UI** address. On the first visit, Listmonk asks you to create the super-admin account. Save that password in your password manager. StartOS does not generate, store, or display it.
2. Go to **Settings > General** and set **Root URL** to the address subscribers will use (for example `https://news.example.com`). Links in emails, opt-in confirmations, and unsubscribe links are built from this value, so it must be an address the public can reach.
3. Go to **Settings > SMTP** and add the mail server that will send your campaigns. Use **Test connection** before you save.
4. Send a test campaign to yourself before sending to a list.

## Before sending to real subscribers

- **Public address.** Subscribers open unsubscribe, opt-in, and archive links from their inbox, so the Web UI needs a public domain (clearnet), not only a LAN or Tor address.
- **Email authentication.** Set up SPF, DKIM, and DMARC DNS records for your sending domain. Without them, most campaigns land in spam.
- **Legal footer.** US law (CAN-SPAM) requires a physical mailing address and a working unsubscribe link in every commercial email. listmonk templates include the unsubscribe link by default; add your address to the template footer.
- **Double opt-in.** Create lists as **Double opt-in** so each subscriber confirms their address.

## Account recovery

Listmonk owns the admin account and password. StartOS does not retain a copy. Configure SMTP and verify password-reset email before depending on it, and keep the password in your password manager.

## Backups

StartOS backups include the full database (as a PostgreSQL dump), uploaded media, and the internal database password.
