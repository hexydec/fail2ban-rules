# Fail2ban Rules for Malicious Web Traffic
[![Tests](https://github.com/hexydec/fail2ban-rules/actions/workflows/test.yml/badge.svg)](https://github.com/hexydec/fail2ban-rules/actions/workflows/test.yml)
Useful fail2ban rules for detecting and banning malicious web traffic using Nginx access logs in combined format.

## Usage
The filters are placed in [src/filter.d/](src/filter.d/), copy these files into your fail2ban configuration folder, and then setup the required jails to use them.

[Example jail configuration is provided](src/jail.conf), *note this is Plesk specific and will require tweaking to your setup*.

## Before you turn these on
These rules ban real people if your site legitimately serves any of the things they look for. Work through this list on a copy of your own logs before any of it reaches a live jail. Every step below is read-only except the last one.

### 1. Check fail2ban sees the visitor, not your proxy
If nginx sits behind Cloudflare, a load balancer or a Plesk reverse proxy, the first field of your access log is the proxy, and these filters will ban it — taking your whole site off the internet. Confirm the log holds real client addresses:

```sh
awk '{print $1}' /var/www/vhosts/system/example.com/logs/access_log | sort -u | head
```

If you see one address, or your proxy's range, fix nginx first with `set_real_ip_from` and `real_ip_header` and check again.

### 2. Check the log format
Every filter here expects the nginx `combined` format, and `nginx-scrapers` counts quoted fields to reach the user agent, so a custom `log_format` will silently match nothing. One line should look like:

```
203.0.113.7 - - [28/Aug/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0 ..."
```

The two dashes after the address are the ident field, which nginx hardcodes, and `$remote_user`, which basic auth fills in. `nginx-scrapers` requires both so that an authenticated request is never banned, so keep them if you build your own format.

`nginx-excessive-reqs` is the exception and reads the nginx **error** log instead.

### 3. Dry run every filter over your real logs
`fail2ban-regex` reports what a filter would have caught without banning anybody:

```sh
for f in /etc/fail2ban/filter.d/nginx-*.conf; do
	echo "== $f"
	fail2ban-regex /var/www/vhosts/system/example.com/logs/access_log "$f" | tail -3
done
```

Then list the addresses each filter would ban, busiest first:

```sh
fail2ban-regex -o ip /path/to/access_log /etc/fail2ban/filter.d/nginx-badreqs.conf \
	| sort | uniq -c | sort -rn | head -20
```

### 4. Look up whatever it would ban
Reverse DNS every address from the step above before you believe the filter is right. A ban list that includes search engines, an uptime monitor, your own office or a payment provider's callback is a configuration problem, not a catch:

```sh
fail2ban-regex -o ip /path/to/access_log /etc/fail2ban/filter.d/nginx-scrapers.conf \
	| sort -u | while read -r ip; do printf '%s\t%s\n' "$ip" "$(dig +short -x "$ip")"; done
```

### 5. Run your own URLs through the filters
The keyword list in `nginx-badreqs` holds everyday words — `account`, `index`, `info`, `local`, `test`, `user` — and it only counts them on a 404. A page of yours that gets renamed, or a stale link in an email, will 404 on a keyword and count towards a ban. Turn your own sitemap into log lines and see what matches:

```sh
curl -s https://example.com/sitemap.xml \
	| grep -oP '(?<=<loc>)[^<]+' \
	| sed 's|https\?://[^/]*||' \
	| while read -r url; do
		printf '203.0.113.1 - - [01/Jan/2026:00:00:00 +0000] "GET %s HTTP/1.1" 404 1 "-" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"\n' "$url"
	done > /tmp/mine.log
fail2ban-regex --print-all-matched --print-no-missed /tmp/mine.log /etc/fail2ban/filter.d/nginx-badreqs.conf
```

Anything matched is a page of yours that would count against a visitor the day it starts returning 404. Either accept it, or drop that keyword from your copy of the filter.

Do the same for `nginx-exploit`, which does not care about the status code at all. If your own URLs carry `;`, `&&`, `${`, a pipe followed by a word like `cat` or `id`, or anything that reads as an encoded traversal, that filter will ban visitors at the first request. Search your templates and your analytics for those characters before enabling it.

### 6. Set the numbers to your traffic, not to these defaults
The `maxretry` values in [src/jail.conf](src/jail.conf) suit a small site. Count what a normal day looks like first — if a single visitor legitimately triggers a filter forty times an hour, `maxretry = 10` bans them:

```sh
fail2ban-regex -o ip /path/to/access_log /etc/fail2ban/filter.d/nginx-404.conf \
	| sort | uniq -c | sort -rn | awk '$1 > 5'
```

### 7. Whitelist yourself before the first jail starts
In `jail.local`, so that a mistake does not lock you out of your own server:

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 203.0.113.0/24
```

Include your office, your VPN, your monitoring, and any CI that hits the site.

### 8. Start one jail at a time, with a short ban
Enable a single filter with `bantime = 60`, leave it a day, and read what it did:

```sh
fail2ban-client status nginx-badreqs
tail -f /var/log/fail2ban.log
```

Raise `bantime` only once a day's worth of bans all look deserved, and only then add the next jail.

### 9. Keep checking after it is live
A ban you never hear about is the expensive kind. `fail2ban-client status <jail>` lists currently banned addresses, and the log holds the line that triggered each one:

```sh
grep 'Ban ' /var/log/fail2ban.log | awk '{print $NF}' | sort | uniq -c | sort -rn
```

If a customer reports the site is down for them and fine for everyone else, check that list first.

## Testing
The filters are covered by a [Vitest](https://vitest.dev) suite that reads each `.conf` file, compiles its `failregex` and `ignoreregex`, and asserts that specific log lines are or are not treated as a failure. It runs automatically on every push and pull request.

```sh
npm install
npm test        # run once
npm run test:watch
```

Tests live in [tests/](tests/), one file per filter. Log lines are built by the helpers in [tests/helpers/log.js](tests/helpers/log.js), so a case is usually just the part that matters:

```js
expectMatch("nginx-404", accessLog({path: "/.env", status: 404}));
expectNoMatch("nginx-404", accessLog({path: "/favicon.ico", status: 404}));
```

When changing a `failregex`, add a case in both directions: a request the filter should now catch, and a legitimate request it must still leave alone. The false-positive cases matter most, since a bad exclusion bans real visitors.

Two things the harness does that are worth knowing about:

- `<HOST>` is not a regular expression, so it is replaced with a permissive named capture group before compiling. Tests can therefore assert which IP would be banned, not just that the line matched.
- fail2ban strips the timestamp from a line before applying `failregex`, so every assertion is checked against the line both as logged and with the date removed. A pattern that only works with the date present would be broken in production.

The suite also checks [src/jail.conf](src/jail.conf) for consistency, so an example jail cannot reference a filter that does not exist.

### Testing against fail2ban itself
The harness above is a reimplementation, so [tests/fail2ban-regex.test.js](tests/fail2ban-regex.test.js) checks the filters against the real thing. It runs `fail2ban-regex` over the sample logs in [tests/logs/](tests/logs/), one directory per filter:

- `fail.log` - every line must be reported as a failure, banning the client IP written in that line
- `pass.log` - no line may be reported

The expected IP is read out of each line, from the first field of an access log line or the `client:` field of an error log line, so a sample is just a log file with nothing alongside it. Blank lines and `#` comments are stripped before fail2ban reads it, so each group of rows says what it is there to pin. Add a row to each file when you change a filter, the same way as for the Vitest cases.

Every sample row is also run through the Vitest harness and has to get the same answer, so the reimplementation cannot drift away from what fail2ban actually does.

These run whenever `fail2ban-regex` can be found, and are skipped otherwise, so the rest of the suite still runs without fail2ban installed. CI installs it and asserts they were not skipped.

fail2ban is POSIX only, so on Windows the command is run through WSL, which needs fail2ban installed inside the distribution:

```sh
wsl sudo apt-get install -y fail2ban
```

Set `FAIL2BAN_REGEX` to override how the command is found, for example to run it from a source checkout rather than an installed package:

```sh
FAIL2BAN_REGEX="python3 /opt/fail2ban/bin/fail2ban-regex" npm test
```

## Filters
Here is a list of the filter provided:

### [nginx-404.conf](src/filter.d/nginx-404.conf)
Detect `404` statuses, use this to ban IP's that generate many non-existent endpoints in quick succession. This pattern usually happens when malicious actors are probing URL's on your system looking for known weak endpoints, backup files, and other exploitable scripts. 

### [nginx-444.conf](src/filter.d/nginx-444.conf)
Captures requests that returned a `444` status, which nginx only sends where your own configuration says to. Use it to ban clients your vhost has already refused, so that the decision of what is hostile stays in the site config and this filter only acts on it.

### [nginx-auth.conf](src/filter.d/nginx-auth.conf)
Detect `401`/`403` status requests, this can be used for detecting brute-force attempts on secure pages or login scripts.

### [nginx-badreqs.conf](src/filter.d/nginx-badreqs.conf)
Matches specific URL patterns where the request resulted in a `404`. This will capture requests with keywords such as `admin`, `env`, or `backup` which are surrounded by [./_-] characters, e.g. `/.env`, `/wp-content/backup.sql`, or `/aws.yml`.

### [nginx-excessive-post.conf](src/filter.d/nginx-excessive-post.conf)
Captures requests with `POST`, `PUT`, or `DELETE` methods, use this to limit the number that can be made within a certain period.

### [nginx-excessive-reqs.conf](src/filter.d/nginx-excessive-reqs.conf)
Match excessive requests logged by nginx rate limiting from your error log to ban those IP's. 

### [nginx-exploit.conf](src/filter.d/nginx-exploit.conf)
Block URL's containing characters and patterns that clearly indicate an exploit attempt.

### [nginx-limit-reqs.conf](src/filter.d/nginx-limit-reqs.conf)
Captures requests that returned a `429` status, to ban IP's that keep going over your configured rate limit. 

### [nginx-scrapers.conf](src/filter.d/nginx-scrapers.conf)
Use this filter to ban user agents that have a generic scraper name such as `PostmanRuntime`, `Go-Http-Client`, `cURL`, or did not provide a User-Agent string at all.

Requests that got through HTTP basic auth are skipped, as somebody holding a credential running `curl` against your own API is not anonymous scraping. This is read from `$remote_user`, the second field of the combined format, which nginx writes as a dash when nobody authenticated — so this filter is the one that depends on the field layout, and a custom `log_format` stops it matching anything rather than failing loudly.