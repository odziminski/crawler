'use strict';

const puppeteer = require('puppeteer');
const _ = require("underscore");
const pg = require('pg')
const fs = require('fs')

const pool = new pg.Pool({
    host: "localhost",
    user: "postgres",
    port: 5432,
    password: "root",
    database: "crawler"
});

const getImageName = async (href) => {
    return href.substring(href.indexOf('oferta') + 6);

}

const checkForPromotedAdvert = async (href) => {

    if (href.endsWith(';promoted')) {
        href = href.slice(0, -8)
    }
    return href.replace(/[^a-zA-Z ]/g, "");
}



const crawl = async () => {

    try {

        const link = 'https://www.olx.pl/nieruchomosci/mieszkania/wynajem/wroclaw/?search%5Bfilter_float_price%3Ato%5D=3000&search%5Bfilter_float_price%3Afrom%5D=1000&search%5Bfilter_enum_rooms%5D%5B0%5D=two';

        const browser = await puppeteer.launch();
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

        let advertInfo = {};
        const olxPriceSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > div.css-dcwlyx > h3';
        const olxAreaSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > ul > li:nth-child(5) > p';
        const olxAdditionalPaymentsSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > ul > li:nth-child(7) > p';
        const olxDistrictSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-z88e9u > div:nth-child(2) > div > section > div.css-1nrl4q4 > div > p.css-7xdcwc-Text.eu5v0x0 > span';

        const otodomSelector = '#__next > main > div.css-17vqyja.e1t9fvcw3 > div.css-1sxg93g.e1t9fvcw1 > header > strong';

        let i = 0;
        for (let href of correctAdverts) {
            console.log('entering ' + href);
            await page.goto(href, {
                waitUntil: 'networkidle2',
                timeout: 0
            });
            let hrefFilename = await checkForPromotedAdvert(href);
                let imgName = await getImageName(hrefFilename);
            if (!fs.existsSync('img/' + imgName + '.png')) {
                await page.screenshot({ path: 'img/' + imgName + '.png', fullPage: true });
                if (href.startsWith('https://www.olx.pl/d/oferta/')) {
                    console.log('success! ' + href)

                    if (await page.$(olxPriceSelector) !== null && (await page.$(olxDistrictSelector) !== null)) {
                        let price = await getData(page, olxPriceSelector, null);
                        let additionalPayments = await getData(page, olxAdditionalPaymentsSelector, 'Czynsz');
                        let area = await getData(page, olxAreaSelector, 'Powierzchnia: ');
                        let district = await getData(page, olxDistrictSelector, null, true);
                        if (!district) {
                            console.log('district not found at ' + href);
                            district = await page.evaluate(el => el.textContent, await page.$(olxDistrictSelector));
                        }
                        advertInfo[i] = {
                            'href': href,
                            'price': price,
                            'additionalPayments': additionalPayments,
                            'area': area,
                            'district': district,
                        };

                        if (district) {
                            console.log('attempting to add a new record ' + href);

                            pool.connect(function (err, client, done) {
                                if (err) {
                                    return console.error('connexion error', err);
                                }
                                client.query("INSERT INTO data (price,href,additional_payments,area,district) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (href) DO NOTHING;", [price, href, additionalPayments, area, district], function () {
                                    done();
                                    console.log(advertInfo);


                                });
                            });

                        }
                        i++;
                    }

                } else {
                    console.log('already in DB');
                }
            }            

        }

        await browser.close();
    } catch (err) {
        console.error(err);
    }



}


(async function main() {
    const cron = require('node-cron');
    cron.schedule('*/20 * * * *', function() {
    crawl();
      });
})();



const getData = async (page, olxSelector, word = null, district = null) => {
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