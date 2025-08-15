# Fail2ban Rules for Malicious Web Traffic
Useful fail2ban rules for detecting and banning malicious web traffic using Nginx access logs in combined format.

## Usage
The filters are placed in [src/filters.d/](src/filters.d/), copy these files into your fail2ban configuration folder, and then setup the required jails to use them. Jail configuration is not provided here to allow you to configure them as needed.

## Filters
Here is a list of the filter provided:

### [nginx-404.conf](src/filters.d/nginx-404.conf)
Detect `404` statuses, use this to ban IP's that generate many non-existent endpoints in quick succession. This pattern usually happens when malicious actors are probing URL's on your system looking for known weak endpoints, backup files, and other exploitable scripts. 

### [nginx-auth.conf](src/filters.d/nginx-auth.conf)
Detect `401`/`403` status requests, this can be used for detecting brute-force attempts on secure pages or login scripts.

### [nginx-badreqs.conf](src/filters.d/nginx-badreqs.conf)
Matches specific URL patterns where the request resulted in a `404`. This will capture requests with keywords such as `admin`, `env`, or `backup` which are surrounded by [./_-] characters, e.g. `/.env`, `/wp-content/backup.sql`, or `/aws.yml`.

### [nginx-excessive-post.conf](src/filters.d/nginx-excessive-post.conf)
Captures requests with `POST`, `PUT`, or `DELETE` methods, use this to limit the number that can be made within a certain period.

### [nginx-excessive-reqs.conf](src/filters.d/nginx-excessive-reqs.conf)
Match excessive requests logged by nginx rate limiting from your error log to ban those IP's. 

### [nginx-limit-reqs.conf](src/filters.d/nginx-limit-reqs.conf)
Captures requests that returned a `429` status, to ban IP's that keep going over your configured rate limit. 

### [nginx-scrapers.conf](src/filters.d/nginx-scrapers.conf)
Use this filter to ban user agents that have a generic scraper name such as `PostmanRuntime`, `Go-Http-Client`, `cURL`, or did not provide a User-Agent string at all.