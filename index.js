'use strict';

const puppeteer = require('puppeteer');
const _ = require("underscore");
const pg = require('pg')
const pool = new pg.Pool({
    host:  "localhost",
    user: "postgres",
    port: 5432,
    password: "root",
    database: "crawler"
});


(async function main() {

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
            function(s) {
                return s.indexOf('https://www.olx.pl/d/oferta/') !== -1 || s.indexOf('https://www.otodom.pl/pl/oferta/') !== -1;
            }
        );

        let advertInfo = {};
        const olxPriceSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > div.css-dcwlyx > h3';
        const olxAreaSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > ul > li:nth-child(5) > p';
        const olxAdditionalPaymentsSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-dwud4b > div.css-1wws9er > ul > li:nth-child(7) > p';

        const otodomSelector = '#__next > main > div.css-17vqyja.e1t9fvcw3 > div.css-1sxg93g.e1t9fvcw1 > header > strong';

        let i = 0;
        for (const href of correctAdverts) {

            await page.goto(href, {
                waitUntil: 'networkidle2',
                timeout: 0
            });
            // await page.screenshot({path: 'img/' + Date.now() + '.png', fullPage: true});
            if (!href.indexOf('https://www.olx.pl/d/oferta/')) {
                console.log('success! ' + href)

                if (await page.$(olxPriceSelector) !== null){
                    let price = await getData(page, olxPriceSelector, null);
                    let additionalPayments = await getData(page, olxAdditionalPaymentsSelector, 'Czynsz');
                    let area = await getData(page, olxAreaSelector, 'Powierzchnia: ');
                    advertInfo[i] = {
                        'href': href,
                        'price': price,
                        'additionalPayments': additionalPayments,
                        'area': area
                    };

                    pool.connect(function(err, client, done) {
                        if(err) {
                            return console.error('connexion error', err);
                        }
                        client.query("INSERT INTO data (price,href,additional_payments,area) VALUES ($1,$2,$3,$4) ON CONFLICT (href) DO NOTHING;", [price,href,additionalPayments,area], function() {
                            done();


                        });
                    });
                    i++;
                }

            } else {
                if (await page.$(olxPriceSelector) !== null){
                    let element = await page.$(otodomSelector)
                    let value = await page.evaluate(el => el.textContent, element)
                    advertInfo[href] = value;
                }
            }

        }
        console.log(advertInfo);

        await browser.close();
    } catch (err) {
        console.error(err);
    }



})();




const getData = async (page, olxSelector, word = null) => {
    if (await page.$(olxSelector) !== null) {
        let data = await page.evaluate(el => el.textContent, await page.$(olxSelector))
        if (word) {
            if (!data.indexOf(word)) {
                return data.replace(/[^\d.,]/g, '');
            }
        } else return data.replace(/\D/g, '');
    }
}

