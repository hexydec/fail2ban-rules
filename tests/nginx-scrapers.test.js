import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {accessLog, browserAgent} from "./helpers/log.js";

const filter = "nginx-scrapers";

describe("nginx-scrapers", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", agent: "curl/8.5.0"}))).toBe("203.0.113.7");
	});

	it("matches a request with no user agent at all", () => {
		expectMatch(filter, accessLog({agent: "-"}));
	});

	// A bare product token with nothing after it is not a real browser
	describe("matches a truncated Mozilla token", () => {
		for (const agent of ["Mozilla/4.0", "Mozilla/5.0"]) {
			it(agent, () => {
				expectMatch(filter, accessLog({agent}));
			});
		}
	});

	describe("matches generic client and library user agents", () => {
		const agents = [
			"curl/8.5.0",
			"python-requests/2.31.0",
			"GuzzleHttp/7",
			"GuzzleHttp/6",
			"Guzzle/4.2 curl/7.64.0 PHP/7.4",
			"TestUserAgent",
			"PostmanRuntime/7.36.0",
			"okhttp/4.12.0",
			"node-fetch",
			"Go-http-client/1.1",
			"Java/17.0.1",
			"axios/1.6.7",
			"Deno/1.40.2",
			"bun/1.0.25",
			"cpp-httplib/0.14",
			"CakePHP",
			"jsdom/24.0.0",
			"HeadlessChrome/120.0.0.0",
			"PowerShell/7.4.1",
			"CyotekHTTP/6.1",
			"CyotekWebCopy/1.9",
			"Grabber/1.0",
			"photon/1.0",
			"grub/1.0",
			"moblie/1.0",
			"amazon-kendra-customer-id/1.0"
		];
		for (const agent of agents) {
			it(agent, () => {
				expectMatch(filter, accessLog({agent}));
			});
		}
	});

	describe("ignores genuine browsers", () => {
		const agents = {
			"Chrome on Windows": browserAgent,
			"Safari on macOS": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
			"Firefox on Windows": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
			"Safari on iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
			"Chrome on Android": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			"Edge on Windows": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
			"Googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			"Bingbot": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"
		};
		for (const [name, agent] of Object.entries(agents)) {
			it(name, () => {
				expectNoMatch(filter, accessLog({agent}));
			});
		}
	});

	// Browsers request these two on any page load, and a generic or absent agent on them is not worth
	// banning over
	describe("ignores excluded paths whatever the user agent", () => {
		for (const path of ["/favicon.ico", "/manifest.json"]) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, agent: "-"}));
			});
		}
	});

	describe("ignores methods outside the listed set", () => {
		for (const method of ["HEAD", "OPTIONS"]) {
			it(method, () => {
				expectNoMatch(filter, accessLog({method, agent: "curl/8.5.0"}));
			});
		}
	});

	// The client name alternation is wrapped in (?i:), because a generic scraper is a generic scraper
	// whatever case it announces itself in. These are the real user agents these tools send
	describe("matches tools whose real user agent differs in case from the keyword", () => {
		const agents = [
			"Wget/1.21.4",
			"Python-urllib/3.11",
			"Ruby",
			"Scrapy/2.11.0 (+https://scrapy.org)",
			"CURL/8.5.0",
			"GUZZLEHTTP/7",
			"Photon/1.0",
			"Python/3.14 aiohttp/3.13.5"
		];
		for (const agent of agents) {
			it(agent, () => {
				expectMatch(filter, accessLog({agent}));
			});
		}
	});

	// GuzzleHttp is PHP's dominant HTTP client and belongs with curl, python and okhttp. It needs the
	// full "GuzzleHttp" token, because after a bare "Guzzle" the trailing [ \/-] cannot consume "Http"
	// before the closing quote. "Guzzle" is kept for the older "Guzzle/4.2 curl/..." form
	describe("requires the whole client token, not a prefix of it", () => {
		for (const agent of ["GuzzleHttpFooBar", "TestUserAgentX", "curlybrowser/1.0"]) {
			it(agent, () => {
				expectNoMatch(filter, accessLog({agent}));
			});
		}
	});

	// A bare "client" keyword matched inside legitimate product names, so the tool is named explicitly
	// as go-http-client. java carries a (?=\/) lookahead for the same reason: on its own it fires on
	// the java version another product reports. All of these were seen in real logs
	describe("does not count products that merely contain client or java", () => {
		const agents = {
			"eM Client, a desktop email client": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.87 Safari/537.36 eM Client/9.2.1735.0",
			"the Steam in-game browser": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Valve Steam Client/default/1769025840) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.183 Safari/537.36",
			"an Apple CFNetwork system service": "Client/69639 CFNetwork/3860.400.51 Darwin/25.3.0",
			"yacybot, which reports its java version": "yacybot (-global; amd64 Windows 11 10.0; java 25.0.2; Europe/de) http://yacy.net/bot.html"
		};
		for (const [name, agent] of Object.entries(agents)) {
			it(name, () => {
				expectNoMatch(filter, accessLog({agent}));
			});
		}
	});

	// the real user agents they exist for are still caught, in any casing, now that the whole client
	// list sits inside a single (?i:) group
	describe("still catches the tools client and Java are there for", () => {
		for (const agent of ["Java/17.0.1", "java/21", "JAVA/8", "Go-http-client/1.1", "Go-http-client/2.0",
				"Go-Http-Client/1.1", "GO-HTTP-CLIENT/1.1", "ktor-client", "ktor-client/2.3.7", "Ktor-client"]) {
			it(agent, () => {
				expectMatch(filter, accessLog({agent}));
			});
		}
	});
});
