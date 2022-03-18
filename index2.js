'use strict';

const puppeteer = require('puppeteer');
const _ = require("underscore");
const pg = require('pg')
const pool = new pg.Pool({
    host: "localhost",
    user: "postgres",
    port: 5432,
    password: "root",
    database: "crawler"
});
const getLinks = async () => {
    const link = 'https://www.olx.pl/nieruchomosci/mieszkania/wynajem/wroclaw/?search%5Bfilter_float_price%3Ato%5D=3000&search%5Bfilter_float_price%3Afrom%5D=1000&search%5Bfilter_enum_rooms%5D%5B0%5D=two';

    const browser = await puppeteer.launch({
        ignoreHTTPSErrors: true,
    });
    const [page] = await browser.pages();

    await page.goto(link);

    const allHrefs = await page.evaluate(
        () => Array.from(
            document.querySelectorAll('a[href]'),
            a => a.getAttribute('href')
        )
    );

    const uniqueHrefs = allHrefs.filter((x, i, a) => a.indexOf(x) == i)

    var correctAdverts = _.filter(
        uniqueHrefs,
        function (s) {
            return s.indexOf('https://www.olx.pl/d/oferta/') !== -1 || s.indexOf('https://www.otodom.pl/pl/oferta/') !== -1;
        }

    );

    return correctAdverts;
}



const getData = async (page, olxSelector, word = null, district = false) => {
    if (await page.$(olxSelector) !== null) {
        let data = await page.evaluate(el => el.textContent, await page.$(olxSelector))
        if (district) return data;
        if (word) {
            if (!data.indexOf(word)) {
                return data.replace(/[^\d.,]/g, '');
            }
        } else return data.replace(/\D/g, '');
    }
}

const getHref = async (href) => {

    const client = await pool.connect()
    const result = await client.query({
      rowMode: 'array',
      text: 'SELECT href FROM data WHERE href = $1',
      values: [href]
    })
    await client.end()

  return result.rows[0];

}


(async function main() {

    const olxPriceSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > div.css-dcwlyx > h3';
    const olxAreaSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > ul > li:nth-child(5) > p';
    const olxAdditionalPaymentsSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > ul > li:nth-child(7) > p';
    const olxDistrictSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-z88e9u > div:nth-child(2) > div > section > div.css-1nrl4q4 > div > p.css-7xdcwc-Text.eu5v0x0 > span';

    const otodomSelector = '#__next > main > div.css-17vqyja.e1t9fvcw3 > div.css-1sxg93g.e1t9fvcw1 > header > strong';

    const insertQuery = "INSERT INTO data (price,href,additional_payments,area,district) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (href) DO NOTHING;";
    const withBrowser = async (fn) => {
        const browser = await puppeteer.launch({
            ignoreHTTPSErrors: true,
        });
        try {
            return await fn(browser);
        } finally {
            await browser.close();
        }
    }

    const withPage = (browser) => async (fn) => {
        const page = await browser.newPage();
        try {
            return await fn(page);
        } finally {
            await page.close();
        }
    }

    const urls = await getLinks();
    const results = await withBrowser(async (browser) => {
        return Promise.all(urls.map(async (href) => {
            return withPage(browser)(async (page) => {
                await page.goto(href, {
                    waitUntil: 'networkidle2',
                    timeout: 0
                });
                let hrefExists = await getHref(href);
                
                if (!hrefExists && !href.indexOf('https://www.olx.pl/d/oferta/')) {
                    if (await page.$(olxPriceSelector) !== null) {
                        console.log('entering ' + href);
                        let price = await getData(page, olxPriceSelector, null);
                        let additionalPayments = await getData(page, olxAdditionalPaymentsSelector, 'Czynsz');
                        let area = await getData(page, olxAreaSelector, 'Powierzchnia: ');
                        let district = await getData(page, olxDistrictSelector, null, true);
                        if (!district){
                            console.log('district not found at ' + href);
                            district = await page.evaluate(el => el.textContent, await page.$(olxDistrictSelector));
                        }
                        const values = [price, href, additionalPayments, area, district];

                        pool.connect(function (err, client, done) {
                            client.query(insertQuery, values, (err, res) => {
                                done();
                                if (!res) {
                                    console.log('dead');
                                } else {
                                    console.log(values);
                                }

                            });
                        });
                    }

                }
            });
        }))
    });
})();