'use strict';

const puppeteer = require('puppeteer');
const _ = require("underscore");
const pg = require('pg')
const fs = require('fs');
const AWS = require('aws-sdk');
const ID = 'AKIAQ22Y4SZAKAJ6QLWX';
const SECRET = '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';
const s3 = new AWS.S3({
    accessKeyId: ID,
    secretAccessKey: SECRET
});

const BUCKET_NAME = 'crawler-scraper-bucket';

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

        const browser = await puppeteer.launch({
            'args': [
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
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

        let advertInfo = {};

        const olxPriceSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1vnw4ly > div.css-1wws9er > div.css-dcwlyx > h3';
        const olxAreaSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1vnw4ly > div.css-1wws9er > ul > li:nth-child(5) > p';
        const olxAdditionalPaymentsSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1vnw4ly > div.css-1wws9er > ul > li:nth-child(7) > p';
        const olxDistrictSelector = '#root > div.css-50cyfj > div.css-1on7yx1 > div:nth-child(3) > div.css-1pyxm30 > div:nth-child(2) > div > section > div.css-1nrl4q4 > div > p.css-7xdcwc-Text.eu5v0x0 > span';

        const otodomSelector = '#__next > main > div.css-17vqyja.e1t9fvcw3 > div.css-1sxg93g.e1t9fvcw1 > header > strong';
        console.log(correctAdverts);
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

                const screenshot = await page.screenshot({
                    fullPage: true
                });
                const params = { Bucket: BUCKET_NAME, Key: imgName, Body: screenshot };
                await s3.putObject(params).promise();
                s3.upload(params, function(err, data) {
                    if (err) {
                        throw err;
                    }
                    console.log(`File uploaded successfully. ${data.Location}`);
                });

                if (href.startsWith('https://www.olx.pl/d/oferta/')) {
                    console.log('success! ' + href)

                    let price = await getData(page, olxPriceSelector, null);
                    let additionalPayments = await getData(page, olxAdditionalPaymentsSelector, 'Czynsz');
                    let area = await getData(page, olxAreaSelector, 'Powierzchnia: ');
                    console.log(price, additionalPayments, area);

                    let district = await getData(page, olxDistrictSelector, null, true);
                    if (!district) {
                        console.log('district not found at ' + href);
                        if (await page.$(olxDistrictSelector) !== null) {
                            district = await page.evaluate(el => el.textContent, await page.$(olxDistrictSelector));
                        } else {
                            district = 'undefined';
                        }

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
                            client.query("INSERT INTO data (price,href,additional_payments,area,district,image_name) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (href) DO NOTHING;", [price, href, additionalPayments, area, district, imgName], function () {
                                done();


                            });
                            console.log('added ' + href);

                        });

                    }
                    i++;


                } else {
                    console.log('already in DB');
                }
            }

        }
        console.log(advertInfo);

        await browser.close();
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

const uploadFile = (fileName) => {
    const fileContent = fs.readFileSync(fileName);

    const params = {
        Bucket: BUCKET_NAME,
        Key: 'cat.jpg', // File name you want to save as in S3
        Body: fileContent
    };

    // Uploading files to the bucket
    s3.upload(params, function (err, data) {
        if (err) {
            throw err;
        }
        console.log(`File uploaded successfully. ${data.Location}`);
    });
};