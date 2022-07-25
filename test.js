'use strict';
require('dotenv').config();

const puppeteer = require('puppeteer');
const _ = require("underscore");
const pg = require('pg')
const fs = require('fs');

const pool = new pg.Pool({
    host: "ec2-99-81-16-126.eu-west-1.compute.amazonaws.com",
    user: "uexrudscyqkrlu",
    port: 5432,
    password: "d56157f635474960d619b07b046618f031b2fd69432659dff454a8276d58947f",
    database: "dbls649lleuqal",
    ssl: {
        rejectUnauthorized: false,
    }
});

const checkForPromotedAdvert = async (href) => {

    if (href.endsWith(';promoted')) {
        return href.slice(0, -8)
    }
    return href;
}



const crawl = async () => {
    console.log(process.env.AWS_ID);
    try {
        const browser = await puppeteer.launch({
            'args': [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',

            ]
        });
        const [page] = await browser.pages();


        let correctAdverts = ['https://www.olx.pl/d/oferta/mieszkanie-2-pokojowe-43m2-z-balkonem-ul-mulicka-psie-pole-CID3-IDQ0ex4.html#3222b9c8bc', 'https://www.olx.pl/d/oferta/mieszkanie-2-pokojowe-obok-rynku-CID3-IDQ57HI.html#3222b9c8bc;promoted'];
        let advertInfo = {};

        
        console.log(correctAdverts);
        for (let href of correctAdverts) {
           let hrefChecked = await checkForPromotedAdvert(href);
            console.log('entering ' + href);
            await page.goto(href, {
                waitUntil: 'networkidle2',
                timeout: 0
            });
           
            pool.query('DELETE FROM data WHERE href = $1', [hrefChecked], (err, res) => {

            })
            pool.query('SELECT id FROM data WHERE href = $1', [href], (err, res) => {
                if (err) {
                    console.log(err.stack)
                } else if (res.rows[0]) {
                    console.log("already in DB, id = " + JSON.stringify(res.rows[0]))
                } else {
                    insertData(page,href)
                }
            })


        }
        console.log(advertInfo);
        //await browser.close();

    } catch (err) {
        console.error(err);
    }



}


(async function main() {
    // const cron = require('node-cron');
    // cron.schedule('*/20 * * * *', function() {
    crawl();
    //   });
})();

const insertData = async (page,href) => {
    const olxPriceSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1vnw4ly > div.css-1wws9er > div.css-dcwlyx > h3';
    const olxAreaSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1vnw4ly > div.css-1wws9er > ul > li:nth-child(5) > p';
    const olxAdditionalPaymentsSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1vnw4ly > div.css-1wws9er > ul > li:nth-child(7) > p';
    const olxDistrictSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1pyxm30 > div:nth-child(2) > div > section > div.css-1nrl4q4 > div > p.css-7xdcwc-Text.eu5v0x0 > span';

    const otodomSelector = '#__next > main > div.css-17vqyja.e1t9fvcw3 > div.css-1sxg93g.e1t9fvcw1 > header > strong';

    // const screenshot = await page.screenshot({
    //     fullPage: true
    // });
    

    if (href.startsWith('https://www.olx.pl/d/oferta/')) {
        console.log('success! ' + href)

        let price = await getData(page, olxPriceSelector, null);
        let additionalPayments = await getData(page, olxAdditionalPaymentsSelector, 'Czynsz');
        let area = await getData(page, olxAreaSelector, 'Powierzchnia: ');

        let district = await getData(page, olxDistrictSelector, null, true);
        if (!district) {
            if (await page.$(olxDistrictSelector) !== null) {
                district = await page.evaluate(el => el.textContent, await page.$(olxDistrictSelector));
            } else district = 'undefined';

        } else {


            pool.query("INSERT INTO data (price,href,additional_payments,area,district) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (href) DO NOTHING;", [price, href, additionalPayments, area, district], function () {})
            console.log('added ' + href);

        }

    }


}



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


