import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {accessLog} from "./helpers/log.js";

const filter = "nginx-404";

describe("nginx-404", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", path: "/.env", status: 404}))).toBe("203.0.113.7");
	});

	describe("matches probing for non-existent endpoints", () => {
		const paths = [
			"/.env",
			"/wp-login.php",
			"/backup.sql",
			"/phpinfo.php",
			"/administrator/index.php",
			"/.git/config",
			"/vendor/phpunit/phpunit/phpunit.xsd?x=1", // .xsd is not a listed extension
			"/api/v1/users",
			"/old-page",
			"/some/deep/path/without/an/extension"
		];
		for (const path of paths) {
			it(path, () => {
				expectMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	describe("ignores anything that is not a 404", () => {
		for (const status of [200, 204, 301, 302, 401, 403, 429, 500]) {
			it(`${status}`, () => {
				expectNoMatch(filter, accessLog({path: "/.env", status}));
			});
		}
	});

	// The live failregex excludes by file extension. The commented out previous pattern above it
	// excluded these paths by name, so it doubles as a specification of what must never be banned
	describe("ignores static assets excluded by extension", () => {
		const paths = [
			"/apple-touch-icon.png",
			"/apple-touch-icon-precomposed.png",
			"/apple-touch-icon-180x180.png",
			"/apple-touch-icon-120x120-precomposed.png",
			"/apple-touch-startup-image.png",
			"/apple-touch-startup-image-750x1334.png",
			"/favicon.ico",
			"/img/logo.png",
			"/img/photo.jpeg",
			"/img/animation.gif",
			"/img/hero.webp",
			"/img/icon.svg",
			"/video/promo.mp4",
			"/fonts/inter.woff",
			"/fonts/inter.woff2",
			"/img/hero.avif",
			"/video/promo.webm",
			"/fonts/inter.ttf",
			"/fonts/inter.otf",
			"/css/theme.css",
			"/js/app.js",
			"/js/app.js.map",
			"/site.webmanifest",
			"/docs/terms.pdf"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	describe("ignores static assets with a cache busting query string", () => {
		const paths = [
			"/img/logo.png?v=2",
			"/fonts/inter.woff2?1a2b3c",
			"/js/app.js?ver=6.4.1"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// The path is terminated by the space before the protocol, so the lookahead pins the extension to
	// the last dot before a space, a query string or the closing quote. These confirm it is the final
	// extension that counts, not the first
	describe("ignores static assets with a dot earlier in the filename", () => {
		const paths = [
			"/img/image.min.png",
			"/img/logo.2x.png",
			"/css/vendor.a1b2c3.svg",
			"/fonts/inter.v2.woff2",
			"/img/hero.min.png?v=2",
			"/js/app.min.js",
			"/css/theme.v2.min.css"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// Most of the well known URIs in the RFC 8615 registry have no file extension at all, in particular
	// the acme-challenge tokens used for certificate renewal, so the whole directory is excluded
	describe("ignores the well known directory", () => {
		const paths = [
			"/.well-known/acme-challenge/6fd8a1b2c3",
			"/.well-known/change-password",
			"/.well-known/apple-app-site-association",
			"/.well-known/openid-configuration",
			"/.well-known/matrix/server",
			"/.well-known/host-meta",
			"/.well-known/webfinger?resource=acct:someone@example.com",
			"/.well-known/security.txt",
			"/.well-known/assetlinks.json"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// A probe dressed up as a static asset still has to end in a listed extension to be excluded, so
	// these are counted. Note js, css and map are deliberately not in the list
	describe("matches paths that only look like static assets", () => {
		const paths = [
			"/.env.png.php",
			"/wp-content/uploads/shell.png.php",
			"/backup.sql.zip",
			"/well-known/acme-challenge/abc"
		];
		for (const path of paths) {
			it(path, () => {
				expectMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// nginx writes the request line verbatim, so an HTTP/0.9 request is logged with no protocol, as
	// "GET /path". The extension is then terminated by the closing quote rather than a space
	describe("handles a request line logged with no protocol", () => {
		describe("still ignores static assets", () => {
			for (const path of ["/img/logo.png", "/css/theme.css", "/js/app.js", "/fonts/inter.woff2", "/docs/terms.pdf", "/favicon.ico"]) {
				it(path, () => {
					expectNoMatch(filter, accessLog({path, protocol: "", status: 404}));
				});
			}
		});
		// The named exclusions rely on the same path terminator as the extension list, so they need the
		// same coverage
		describe("still ignores well known files", () => {
			for (const path of ["/robots.txt", "/sitemap.xml", "/autodiscover/autodiscover.xml", "/manifest.json", "/humans.txt"]) {
				it(path, () => {
					expectNoMatch(filter, accessLog({path, protocol: "", status: 404}));
				});
			}
		});
		describe("still matches probes", () => {
			for (const path of ["/.env", "/wp-login.php", "/backup.sql", "/test.exe", "/.git/config"]) {
				it(path, () => {
					expectMatch(filter, accessLog({path, protocol: "", status: 404}));
				});
			}
		});
	});

	// The only request shape where the trailing [^"]* differs from [^"]+ is an empty path, ie a request
	// line of "GET " with nothing after the method. A star counts it, a plus would let it through
	it("matches a malformed request line with no path", () => {
		expectMatch(filter, '1.2.3.4 - - [28/Aug/2026:10:00:00 +0000] "GET " 404 1234 "-" "-"');
	});

	// These are all covered by the txt, xml and json extensions rather than being named individually,
	// which is why the naming variants below need no special handling
	describe("ignores well known files that browsers and crawlers request", () => {
		const paths = [
			"/robots.txt",
			"/ads.txt",
			"/security.txt",
			"/humans.txt",
			"/sitemap.xml",
			"/sitemap_index.xml",
			"/post-sitemap.xml",
			"/wp-sitemap.xml",
			"/en/sitemap.xml",
			"/crossdomain.xml",
			"/browserconfig.xml",
			"/autodiscover.xml",
			"/autodiscover/autodiscover.xml",
			"/AutoDiscover/AutoDiscover.xml",
			"/Autodiscover/Autodiscover.xml",
			"/manifest.json",
			"/static/manifest.json",
			"/robots.txt?v=2"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// Because txt, xml and json are excluded wholesale, single probes for these files are not counted
	// here. That is deliberate: this filter is a volume heuristic, and a scanner spraying paths trips
	// maxretry on the rest of its requests. Targeted probes for named files are nginx-badreqs' job
	describe("does not count text format probes, which nginx-badreqs covers", () => {
		const paths = [
			"/readme.txt",
			"/CHANGELOG.txt",
			"/license.txt",
			"/passwords.txt",
			"/.env.txt",
			"/wlwmanifest.xml",
			"/wp-includes/wlwmanifest.xml",
			"/phpunit.xml",
			"/composer.json",
			"/package.json",
			"/package-lock.json",
			"/appsettings.json",
			"/credentials.json",
			"/secrets.json",
			"/config.json",
			"/tsconfig.json",
			"/data/config.json",
			"/data/site.config.json",
			"/.vscode/sftp.json"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, status: 404}));
			});
		}
	});

	// A compressed sitemap is legitimate and requested by search engines, but gz as a whole extension
	// cannot be excluded because compressed archives are a common probe target, so this one file is
	// named explicitly
	describe("handles the compressed sitemap", () => {
		it("ignores /sitemap.xml.gz", () => {
			expectNoMatch(filter, accessLog({path: "/sitemap.xml.gz", status: 404}));
		});
		it("ignores /sitemap.xml.gz with a query string", () => {
			expectNoMatch(filter, accessLog({path: "/sitemap.xml.gz?v=2", status: 404}));
		});
		describe("still counts other compressed files", () => {
			for (const path of ["/backup.sql.gz", "/db.tar.gz", "/www.tar.gz", "/sitemap.xml.gz.php", "/etc/sitemap.xml.gz"]) {
				it(path, () => {
					expectMatch(filter, accessLog({path, status: 404}));
				});
			}
		});
	});
});
