import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost, parseFilter} from "./helpers/filter.js";
import {accessLog} from "./helpers/log.js";

const filter = "nginx-badreqs",
		// the keyword alternation is the only group in the pattern with a large number of members
		keywords = parseFilter(filter).failregex[0].match(/\(\?i?:([a-z0-9_|-]{200,})\)/)[1].split("|");

describe("nginx-badreqs", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", path: "/.env", status: 404}))).toBe("203.0.113.7");
	});

	// The three examples given in the README
	describe("matches the documented examples", () => {
		for (const path of ["/.env", "/wp-content/backup.sql", "/aws.yml"]) {
			it(path, () => {
				expectMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	describe("matches probes for known weak endpoints", () => {
		const paths = [
			"/.git/config",
			"/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
			"/wp-login.php",
			"/wp-admin/setup-config.php",
			"/xmlrpc.php",
			"/phpinfo.php",
			"/administrator/index.php",
			"/api/v1/secret",
			"/.aws/credentials",
			"/db_backup.zip",
			"/config.old",
			"/laravel/.env",
			"/docker-compose.yml",
			"/.vscode/sftp.json",
			"/swagger/index.html"
		];
		for (const path of paths) {
			it(path, () => {
				expectMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	describe("matches every method", () => {
		for (const method of ["GET", "POST", "HEAD", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
			it(method, () => {
				expectMatch(filter, accessLog({method, path: "/.env", status: 404}));
			});
		}
	});

	// The filter only counts probes that found nothing, so a keyword path that actually exists on the
	// site is left alone
	describe("ignores anything that is not a 404", () => {
		for (const status of [200, 204, 301, 302, 401, 403, 429, 500]) {
			it(`${status}`, () => {
				expectNoMatch(filter, accessLog({path: "/.env", status}));
			});
		}
	});

	describe("ignores explicitly excluded paths", () => {
		const paths = [
			"/.well-known/acme-challenge/6fd8a1b2c3",
			"/.well-known/security.txt",
			"/.well-known/change-password",
			"/manifest.json"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	describe("ignores ordinary 404s with no keyword in the path", () => {
		const paths = [
			"/about-us",
			"/contact",
			"/products/widget-9000",
			"/favicon.ico",
			"/img/logo.png"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// The keyword list is broad and contains a number of everyday words. A 404 on any of these paths
	// counts towards a ban, which is worth knowing given the example jail bans for a day after 5 hits.
	// The keyword can appear anywhere in the path, not just the first segment, so an article slug
	// containing one is caught too. Pinned so that any future narrowing of the list shows up here
	describe("also matches everyday paths built from keywords in the list", () => {
		const paths = [
			"/main.css",
			"/user-guide",
			"/new-products",
			"/home-page",
			"/info.html",
			"/site-map",
			"/test-drive",
			"/app.js",
			"/local-news",
			"/blog/2026/08/a-post-that-moved"
		];
		for (const path of paths) {
			it(path, () => {
				expectMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// The keyword must sit on a [/_.-] boundary, so a longer word that merely contains one is ignored
	describe("ignores words that merely contain a keyword", () => {
		for (const path of ["/administrivia-x", "/reconfigure", "/postage", "/newsletter"]) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// Every keyword in the alternation, read straight out of the conf so that adding one to the filter
	// automatically covers it here. This is what guarantees no keyword is dead or shadowed by a shorter
	// one earlier in the list
	describe("catches every keyword in the list", () => {
		it("declares no duplicate keywords", () => {
			const seen = new Set();
			expect(keywords.filter(k => seen.size === seen.add(k).size)).toEqual([]);
		});

		it("declares a plausible number of keywords", () => {
			expect(keywords.length).toBeGreaterThan(100);
		});

		for (const keyword of new Set(keywords)) {
			it(keyword, () => {
				// the keyword has to sit on a [/_.-] boundary, so exercise each way it can be delimited
				const upper = keyword.toUpperCase(),
						capital = keyword[0].toUpperCase() + keyword.slice(1);
				for (const path of [
					`/${keyword}`,
					`/${keyword}.php`,
					`/${keyword}/`,
					`/wp-content/${keyword}.txt`,
					`/a-${keyword}_b`,
					`/x/${keyword}/y`,
					// the alternation is wrapped in (?i:), because scanners routinely use capitals
					`/${upper}`,
					`/${capital}.php`,
					`/x/${upper}/y`
				]) {
					expectMatch(filter, accessLog({path, status: 404}));
				}
			});
		}
	});

	// The keyword alternation is wrapped in (?i:), so capitalised routes count too. These only matter
	// on a 404, so a live page is never affected, but a removed or renamed route that keeps getting
	// requested by stale links and crawlers will accumulate hits. Pinned so the exposure is visible
	describe("case insensitivity extends matching to capitalised routes", () => {
		describe("counts these on a 404", () => {
			for (const path of ["/Home/Index", "/Home/About", "/Account/Login", "/Manage/Index", "/User/Profile", "/Blog/My-Post", "/CHANGELOG.txt", "/Gemfile", "/.DS_Store", "/WP-ADMIN/setup-config.php"]) {
				it(path, () => {
					expectMatch(filter, accessLog({path, status: 404}));
				});
			}
		});
		describe("still ignores these on a 404", () => {
			for (const path of ["/Account/Register", "/Products/Widget", "/Contact-Us", "/About-Us", "/News/2026/Summer", "/Sitemap.xml", "/Basket", "/Checkout", "/Downloads/Brochure.pdf"]) {
				it(path, () => {
					expectNoMatch(filter, accessLog({path, status: 404}));
				});
			}
		});
		describe("never counts a page that resolves", () => {
			for (const status of [200, 301, 302]) {
				it(`/Home/Index at ${status}`, () => {
					expectNoMatch(filter, accessLog({path: "/Home/Index", status}));
				});
			}
		});
	});

	// Everyday keywords such as app, site, post and index fire on legitimate well known files, which
	// have no extension based exclusion here as they do in nginx-404, so they are named. All of these
	// were seen 404ing from verified crawler IP ranges in real logs
	describe("ignores legitimate well known files", () => {
		const paths = [
			"/manifest.json",
			"/site.webmanifest",
			"/ads.txt",
			"/app-ads.txt",
			"/robots.txt",
			"/security.txt",
			"/humans.txt",
			"/apple-app-site-association",
			"/apple-app-site-association/",
			"/sitemap.xml",
			"/sitemap_index.xml",
			"/post-sitemap.xml",
			"/wp-sitemap.xml",
			"/browserconfig.xml",
			"/crossdomain.xml",
			"/robots.txt?v=2"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// The exclusion is anchored to the whole filename, so a probe that appends to one is still counted
	describe("still counts probes that only start with a well known filename", () => {
		// note /sitemap.xml.php is not covered, but not because of the exclusion: no keyword matches it,
		// as "site" cannot sit on a boundary inside "sitemap". Pre-existing, listed here for clarity
		for (const path of ["/apple-app-site-association.php", "/manifest.json.bak", "/site.webmanifest.php"]) {
			it(path, () => {
				expectMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// Probe families found in real logs that nginx-404 cannot see, because they end in .png, .gif or
	// .js and are excluded there by extension
	describe("catches CMS probe families hidden behind static extensions", () => {
		const paths = [
			"/zb_users/avatar/0.png",
			"/zb_users/plugin/UEditor/themes/default/images/cursor_v.gif",
			"/member/templets/images/icon1.gif",
			"/theme/metron/js/metron.js",
			"/ueditor/net/controller.ashx",
			"/include/ueditor/php/controller.php"
		];
		for (const path of paths) {
			it(path, () => {
				expectMatch(filter, accessLog({path, status: 404}));
			});
		}
	});
});
