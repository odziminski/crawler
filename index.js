'use strict';
if (process.env.NODE_ENV !== 'production')
    require('dotenv').config()


const puppeteer = require('puppeteer');
const _ = require("underscore");
var cron = require('node-cron');

let dbModule = require('./modules/database.js');
let pool = dbModule.pool;


const checkForPromotedAdvert = async (href) => {

    if (href.endsWith(';promoted')) {
        return href.slice(0, -8)
    }
    return href;
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

const crawl = async () => {
    let mailModule = require('./modules/mail.js');
    let transporter = mailModule.transporter;

    try {

        const link = process.env.OLX_CRAWL_HREF;

        const browser = await puppeteer.launch({
            headless: true,
            'args': [
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });
        const [page] = await browser.pages();
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36";
        await page.setExtraHTTPHeaders({"Accept-Language": "en-US,en;q=0.9"});
        await page.setUserAgent(ua);
        await page.goto(link);

        let correctAdverts = await getCorrectAdverts(browser);
        console.log(correctAdverts);
        let advertInfo = {};

        const olxPriceSelector = process.env.OLX_PRICE_SELECTOR;
        const olxAreaSelector = process.env.OLX_AREA_SELECTOR;
        const olxAdditionalPaymentsSelector = process.env.OLX_ADDITIONAL_PAYMENTS_SELECTOR;
        const olxDistrictSelector = process.env.OLX_DISTRICT_SELECTOR;

        let i = 0;
        for (let href of correctAdverts) {

            // console.log(document.querySelector("#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-n9feq4 > div.css-1wws9er > div.css-dcwlyx > h3"));
            console.log(getCurrentDateString() + 'entering ' + href);
            const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36";
            await page.setExtraHTTPHeaders({"Accept-Language": "en-US,en;q=0.9"});
            await page.setUserAgent(ua);
            await page.goto(href, {
                waitUntil: 'networkidle2',
                timeout: 0
            });

            if (href.startsWith('https://www.olx.pl/d/oferta/')) {
                console.log(getCurrentDateString() + ' success! ' + href)
                let hrefChecked = await checkForPromotedAdvert(href);

                let price = await getData(page, olxPriceSelector, null);
                let additionalPayments = await getData(page, olxAdditionalPaymentsSelector, 'Czynsz');
                let area = await getData(page, olxAreaSelector, 'Powierzchnia: ');

                let district = await getData(page, olxDistrictSelector, null, true);
                console.log(price,additionalPayments,area,district);
                if (!district) {
                    console.log(getCurrentDateString() + ' district not found at ' + href);
                    if (await page.$(olxDistrictSelector) !== null) {
                        district = await page.evaluate(el => el.textContent, await page.$(olxDistrictSelector));
                    } else {
                        district = 'undefined';
                    }
                }
                if (price && additionalPayments && area && district) {
                    let totalCost = parseInt(price) + parseInt(additionalPayments);
                    const insertStatement =
                        "INSERT INTO data (price,href,additional_payments,area,district) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (href) DO NOTHING RETURNING *;";

                    console.log(getCurrentDateString() + ' attempting to add a new record ' + href);

                    pool.query(insertStatement, [price, hrefChecked, additionalPayments, area, district], function (error, result) {
                        if (error){
                            console.log(error);
                        }
                        if (result && result.rows[0]) {
                            console.log(getCurrentDateString() + ' added ' + href);
                            advertInfo[i] = {
                                'href': href,
                                'price': price,
                                'additionalPayments': additionalPayments,
                                'area': area,
                                'district': district,
                            };
                            if (totalCost <= 3200) {
                                console.log('sending mail');
                                sendMail(transporter, price, additionalPayments, href, false);
                            }
                        }
                    });

                }
                i++;
            }
        }

        console.log(advertInfo);

        await browser.close();
    } catch (err) {
        console.error(err);
    }


}



const getCorrectAdverts = async (browser) => {
    const [page] = await browser.pages();

    const allHrefs = await page.evaluate(
        () => Array.from(
            document.querySelectorAll('a[href]'),
            a => a.getAttribute('href')
        )
    );

    const uniqueHrefs = allHrefs.filter((x, i, a) => a.indexOf(x) === i)
    return _.filter(
        uniqueHrefs,
        function (s) {
            return s.indexOf('https://www.olx.pl/d/oferta/') !== -1 || s.indexOf('/d/oferta/') !== -1;
        }
    );


}

function getCurrentDateString() {
    let today = new Date();
    return "[" + today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds() + "]";
};

function sendMail(transporter, price, additionalPayments, href, onePerson) {
    let receiver = onePerson ? "jnnkczm@gmail.com" : "magicznasowa16@gmail.com,aleksandra.kucharczyk13@gmail.com";
    let subject = onePerson ? "🤖 Znalazłem pokój w dobrej cenie 🤖" : "🤖 Znalazłem nowe mieszkanie w dobrej cenie 🤖";
    let text = onePerson ? "O godzinie " + getCurrentDateString() + " znalazłem pokój za " + price + "zł, oto link: </br>" + href : "O godzinie " + getCurrentDateString() + " znalazłem mieszkanie za (łącznie) " + (+price + +additionalPayments) + "zł, oto link: </br>" + href;
    console.log(receiver, subject, text);
    transporter.sendMail({
        from: '"Crawler" <' + process.env.GMAIL_EMAIL + '>',
        to: receiver,
        subject: subject,
        text: text,
        html: text
    }).then(info => {
        console.log({
            info
        });
    }).catch(console.error);
}


(async function main() {
    cron.schedule('*/25 * * * *', () => {
        crawl();

    });
})();


