# Fail2ban Rules for Malicious Web Traffic
[![Tests](https://github.com/hexydec/fail2ban-rules/actions/workflows/test.yml/badge.svg)](https://github.com/hexydec/fail2ban-rules/actions/workflows/test.yml)
Useful fail2ban rules for detecting and banning malicious web traffic using Nginx access logs in combined format.

## Usage
The filters are placed in [src/filter.d/](src/filter.d/), copy these files into your fail2ban configuration folder, and then setup the required jails to use them.

[Example jail configuration is provided](src/jail.conf), *note this is Plesk specific and will require tweaking to your setup*.

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
Use this filter to ban user agents that have a generic scraper name such as `PostmanRuntime`, `Go-Http-Client`, `cURL`, or did not provide a User-Agent string at all. If you want to scrape the site, say who you are: anything of your own that hits it should carry its own User-Agent rather than a library default.

Requests that got through HTTP basic auth are skipped.

## Before you turn these on
These rules ban real people if your site legitimately serves any of the things they look for. Work through this list on a copy of your own logs before any of it reaches a live jail.

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

`nginx-excessive-reqs` is the exception and reads the nginx **error** log instead.

### 3. Dry run every filter over your real logs
`fail2ban-regex` reports what a filter would have caught without banning anybody, and prints the log rows it caught:

```sh
for f in /etc/fail2ban/filter.d/nginx-*.conf; do
	echo "== $f"
	fail2ban-regex --print-all-matched --print-no-missed /var/www/vhosts/system/example.com/logs/access_log "$f"
done
```

Read the rows it prints, not just the totals at the end.

### 4. Fix what it caught, or report it
Work through the rows it printed:

- **Legitimate 404s** — an asset that should be there, or a page that has moved. Restore the file or add a redirect.
- **Your own requests with a generic user agent** — a monitor, cron job or deploy hook going out as `curl/8.5.0` or `python-requests/2.31.0`, which is what `nginx-scrapers` bans. Give each one a name: `curl -A 'example.com uptime monitor (ops@example.com)'`. The filter stops anonymous bots, not bots.
- **Legitimate traffic the rules block anyway** — [open an issue](https://github.com/hexydec/fail2ban-rules/issues) with the log line and it becomes a test case.

Then run the dry run again, and see what is left.

### 5. Whitelist yourself before the first jail starts
In `jail.local`, so that a mistake does not lock you out of your own server:

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 203.0.113.0/24
```

Include your office, your VPN, your monitoring, and any CI that hits the site.

### 6. Monitor your logs and adjust
Monitor the bans and identify any legitimate traffic getting blocked.

`fail2ban-client status <jail>` lists who is currently banned, and the log holds the line that caught each one:

```sh
grep 'Ban ' /var/log/fail2ban.log | awk '{print $NF}' | sort | uniq -c | sort -rn
```

If a customer reports the site is down for them and fine for everyone else, check that list first. Loosen `maxretry` or drop a keyword from your copy of the filter where a ban was not deserved, and report the line that caused it as above.

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
