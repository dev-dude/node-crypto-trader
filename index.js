const bittrex = require('node.bittrex.api');
const express = require('express');
const fetch = require('node-fetch');
var Promise = require('bluebird');
const nodemailer = require('nodemailer');
require('datejs');
const tradingStrategy = require('./tradingStrategies.js');
const app = express();
const bodyParser = require('body-parser');
const mysql    = require('mysql');
const path    = require("path");
const AWS = require('aws-sdk');


let transporter = nodemailer.createTransport({
    host: 'smtp.mailgun.org',
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: "",
        pass: ""
    }
});
AWS.config.update({ accessKeyId: '', secretAccessKey: ''});
AWS.config.update({region:'us-east-1'});
const ml = new AWS.MachineLearning({ signatureVersion: 'v4' });

let mailOptions = {
    from: '"', // sender address
    to:'',
    subject: '',
    text: '',
    html: ''
};

let profitPercentage = 0;
let C = {};

let globalBuy = false;
let globalSell = false;
let globalHold = true;
let totalMlLookUps = 0;

let refreshRate = 3000;
let copiedBuyAllocationAccountValueBtc = .200000000;
let buyAllocationAccountValueBtc = .200000000;
let testDatabaseData = [];
let testDatabaseDataSorted = [];
let cacheBiggestCurrencies = [];
let averageCache = {};
let timeSinceLastSell = {};
C.mlProcessing = {};

// The amount of portfolio to spend
const buyAmount = .05000000000;
// The amount to buy above Ask and sell below bid
const buyAboveAskScalar = 1.002;
const sellBelowBidScalar = .998;
const startBuy = true;

let oneRoundFlag = false;
let globalLog = "";

// The scalars
C.dataToProcess = [];
C.globalCounter = 0;

C.longerSMATicksDownward = 400;
C.buyEntryPointScalar = 1.015;
C.startAvgBuyScalar = 0.989;
C.startAvgSellScalar = 1.03;
C.superShortSMATicks = 15;
C.volumeScalar = 1.02;
C.nBuysScalar = 1.025;
C.sellStopLossScalar = -.05;
C.trendDetectorScalar = 1.05;
C.downwardTrendDetectorScalar = .95;
C.sellGainPercentScalar = .15;
C.shortSMATicks = 100;
C.mockTestCount = 0;
C.whenToStartAvgCheck = 200;
C.howManyHoursSMA = 20;
C.logicGate2SnapbackBuy = .03;
C.logicGate3SellScalar = 1.01;
// Minimum volume in btc for the day
C.minimumBaseVolume = 30;
C.oneRound = false;

/********** Tests ************/
/********** Tests ************/
C.mockTest = false;
let cellNotifyEnabled = true;
const liveTest = false;
const mockTestSymbol = "BTC-RCN";
/********** Tests ************/
/********** Tests ************/

let connection = mysql.createConnection({
    host     : '',
    user     : '',
    password : '',
    database : ''
});    
if (C.mockTest) {
    connection = mysql.createConnection({
        host     : '',
        user     : '',
        password : '',
        database : ''
    });
    cellNotifyEnabled = false;
    refreshRate = 10;
    C.oneRound = true;
}

if (liveTest) {
    C.minimumBaseVolume = 1;
    C.trendDetectorScalar = 1.001;
    C.volumeScalar = 1.001;
    C.nBuysScalar = 1.001;
    C.sellStopLossScalar = -.001;
    C.startAvgBuyScalar = 1;
    C.startAvgSellScalar = 1;
    C.buyEntryPointScalar = 1;
    C.whenToStartAvgCheck = 0;
}

// Setup Config
let a = '';
let b = '';

connection.query('SELECT * FROM config WHERE keyVal = "a" OR keyVal = "b"',  {}, function (error, results, fields) {
    results.forEach(function (value) {
        b = value.valueVal;
        if (value.keyVal === "a") {
            a = value.valueVal;
        }
    });
    if (error) throw error;
});

bittrex.options({
    'apikey' : a,
    'apisecret' : b,
    'stream' : false,
    'verbose' : false,
    'cleartext' : false
});

const currenciesToBeTraded = ["BTC-NEM","BTC-XMR","BTC-DASH","BTC-ZEC","BTC-STEEM"];
const tradeAllCurrencies = true;

let currentPositions = [];
let currenciesSnapShot = {};


function updateAveragesInDb(data) {
    // Calculate moving averages
    let p = new Promise(function(resolve, reject) {
        let averagePrice = calculateAveragePriceVolume(data.results, false, false);
        let shortPriceLastNTicks = calculateAveragePriceVolume(data.results, false, C.superShortSMATicks);

        if (averageCache[data.marketName] == null) {
            averageCache[data.marketName] = {avg:[],shortPriceLastNTicks:[]};
        }

        averageCache[data.marketName].avg.push(averagePrice);
        averageCache[data.marketName].shortPriceLastNTicks.push(shortPriceLastNTicks);

        if (C.globalCounter > 3000) {
            averageCache[data.marketName].avg.shift();
            averageCache[data.marketName].shortPriceLastNTicks.shift(shortPriceLastNTicks);
        }

        let averageVolume = calculateAveragePriceVolume(data.results, true, false);
        let averagePriceLastNTicks = calculateAveragePriceVolume(data.results, false, C.shortSMATicks);
        let averageVolumeLastNTicks = calculateAveragePriceVolume(data.results, true, C.shortSMATicks);
        let longerPriceLastNTicks = calculateAveragePriceVolume(data.results, false, C.longerSMATicksDownward);

        if (C.mockTest) {
            let mockResults = {};
            let i = 0;
            for (; i < C.dataToProcess.length; i++) {
            let row = C.dataToProcess[i];
                if (row._id == currenciesSnapShot[data.marketName]._id) {
                    row.averagePrice = averagePrice;
                    row.averageVolume = averageVolume;
                    row.averagePriceLastNTicks = averagePriceLastNTicks;
                    row.averageVolumeLastNTicks = averageVolumeLastNTicks;
                    row.longerPriceLastNTicks = longerPriceLastNTicks;
                    row.shortPriceLastNTicks = shortPriceLastNTicks;
                    mockResults = row;
                    break;
                }
            }
            resolve({
                averagePrice: mockResults.averagePrice,
                averageVolume: mockResults.averageVolume,
                averagePriceLastNTicks: mockResults.averagePriceLastNTicks,
                averageVolumeLastNTicks: mockResults.averageVolumeLastNTicks,
                longerPriceLastNTicks: mockResults.longerPriceLastNTicks,
                shortPriceLastNTicks: mockResults.shortPriceLastNTicks
            });
        } else {
            connection.query('UPDATE historical SET averagePrice = ?, averageVolume = ?, averagePriceLastNTicks = ?, averageVolumeLastNTicks = ?, longerPriceLastNTicks = ?,' +
                'shortPriceLastNTicks = ? WHERE _id = ?', [averagePrice, averageVolume, averagePriceLastNTicks, averageVolumeLastNTicks, longerPriceLastNTicks, shortPriceLastNTicks, currenciesSnapShot[data.marketName]._id], function (error, results, fields) {
                resolve({
                    averagePrice: averagePrice,
                    averageVolume: averageVolume,
                    averagePriceLastNTicks: averagePriceLastNTicks,
                    averageVolumeLastNTicks: averageVolumeLastNTicks,
                    longerPriceLastNTicks: longerPriceLastNTicks,
                    shortPriceLastNTicks: shortPriceLastNTicks
                });
            });

        }
    });
    return p;
}

function getRandomizer(bottom, top) {
    return Math.floor( Math.random() * ( 1 + top - bottom ) ) + bottom;
}

function refreshCode() {
    printStats();
    if (!C.mockTest && C.globalCounter % 400 == 0) {
        cleanTableHistory();
    }
    globalSell = false;
    globalBuy = false;
    globalHold = true;
    logIt("Refresh Rate: " + refreshRate);
    setTimeout(function () {
        if (!oneRoundFlag) {
            refresh();
        }
        globalLog = "";
    }, refreshRate);   
}

//recursive Average Update for every currency
function averageUpdate(databaseData,counter) {
    if (databaseData[counter]) {
        let data = databaseData[counter];
        if (data.results[0] != undefined) {
            updateAveragesInDb(data).then(function (averages) {
                let averagePrice = averages.averagePrice;
                currenciesSnapShot[data.marketName].averagePrice = averagePrice;
                let averageVolume = averages.averageVolume;
                let averagePriceLastNTicks = averages.averagePriceLastNTicks;
                let averageVolumeLastNTicks = averages.averageVolumeLastNTicks;
                let longerPriceLastNTicks = averages.longerPriceLastNTicks;
                let shortPriceLastNTicks = averages.shortPriceLastNTicks;
                buyLogic(data, averagePrice, averageVolume, averagePriceLastNTicks, averageVolumeLastNTicks, shortPriceLastNTicks, longerPriceLastNTicks).then(function(){
                    if (currentPositions.length > 0) {
                        determineSell(data, averagePrice, averageVolume, averagePriceLastNTicks, averageVolumeLastNTicks, longerPriceLastNTicks, shortPriceLastNTicks);
                    }
                    counter++;
                    averageUpdate(databaseData,counter);    
                });
            }).catch(function (e) {
                console.log(e);
            });
        }
    } else {
        console.log("crypto counter: " + counter);
        console.log("done do refresh");
        refreshCode();
    }
}

// ******* MAIN START Code ******** //
function refresh() {
    if (!globalBuy && !globalSell) {
        globalHold = true;
    }  
    getMarketData().then(function(data) {
        if (data != null) {
            let checkAllPricesPromises = checkPriceDataFromDatabase();
            Promise.all(checkAllPricesPromises).then(function (databaseData) {
                averageUpdate(databaseData,0);       
            }).catch(function (e) {
                console.log(e)
            });
        } else {
            console.log("there was some error with the api");
        }
    }).catch(function(e){console.log(e)});
    C.globalCounter++;
}

refresh();

function mlPredict(values,resolve,counter,totalPredictions,firstValue) {
    if (values[counter] != null) {
        let params = {
            MLModelId: '', 
            PredictEndpoint: 'https://realtime.machinelearning.us-east-1.amazonaws.com',
            Record: {
                'volumePercent': String(values[counter]['volumePercent']),
                'buyToSellPercent': String(values[counter]['buyToSellPercent']),
                'spreadPercent': String(values[counter]['spreadPercent'])
            }
        };
        ml.predict(params, function(err, data) {
            totalMlLookUps++;
            if (err) {
                console.log(err, err.stack);
            } else {     
                totalPredictions.push(data["Prediction"].predictedValue);
                counter++;
                mlPredict(values,resolve,counter,totalPredictions,firstValue);
            }
        });
    } else {
        let sum = totalPredictions.reduce(function(a, b) { return a + b; });
        let avg = sum / totalPredictions.length;
        let isBuy = false;
        if (avg > firstValue.lastPercent) {
            isBuy = true;
        }
        counter = 0;
        console.log("ml avg avg > firstValue " + avg + " > " + firstValue.lastPercent + "isBuy " + isBuy);
        resolve(isBuy);
    }
}

function getMlResponse(marketName) {
    let p = new Promise(function(resolve, reject) {
          console.log("ML lookups " + totalMlLookUps);
          let firstValue = 0;
          let predictions = [];
          let query = 'SELECT (Last / (SELECT MIN(Last) FROM historical WHERE MarketName = "'+marketName+'")) as lastPercent,(BaseVolume / (SELECT MIN(BaseVolume) FROM historical WHERE MarketName = "'+marketName+'"))'+
          ' as volumePercent,(OpenBuyOrders/OpenSellOrders) as buyToSellPercent, (1-(Ask - Bid)/Ask) as spreadPercent FROM historical WHERE MarketName = "'+marketName+'" ORDER BY id DESC LIMIT 20';
          connection.query(query, {}, function (error, results, fields) {
            if (error) throw error;
            logIt("got data for ml analysis");
            let i = 0;
            let values = [];
            for (; i < results.length;i++) {
                if (i == 0) {
                    firstValue = results[i]
                }
                if (i % 5 == 0) {
                    values.push(results[i]);
                }
            }
            let counter = 0;
            let predictions = [];
            mlPredict(values,resolve,counter,predictions,firstValue);
        });
    });   
    return p;
}

function cleanTableHistory() {
    let currentUnixTime = Date.now() / 1000;
    let lastHoursSMAPlus1 = ((C.howManyHoursSMA + 1) * 60 * 60 * 1000) / 1000;
    logIt("Cleared: " + lastHoursSMAPlus1);   
    connection.query('REPLACE INTO historical_archive SELECT * FROM historical WHERE unixTime < ?', [lastHoursSMAPlus1], function (error, results, fields) {
        if (error) throw error;
        logIt("cleaned table");
        connection.query('DELETE FROM historical WHERE unixTime < ?', [lastHoursSMAPlus1], function (error, results, fields) {
            if (error) throw error;
            logIt("cleaned table");
        });
    });
   
}

function clearHistoryForTicker(MarketName) {
    logIt("Archiving and deleting Data for: " + MarketName);
    connection.query('INSERT INTO historical_archive SELECT * FROM historical WHERE MarketName = ?', [MarketName], function (error, results, fields) {
        if (error) throw error;
        logIt("Inserted Data into historical_archive");
        connection.query('DELETE FROM historical WHERE MarketName = ?', [MarketName], function (error, results, fields) {
            if (error) throw error;
            logIt("Deleted Data from historical");
        });
    });
}

function getMarketData() {
    let p = new Promise(function(resolve, reject) {
        getMarketDataProcessor(resolve,reject);
    });
    return p;
}

function insertMarketData(data) {
    data.unixTime = getUnixTime(data.TimeStamp);
    currenciesSnapShot[data.MarketName] = data;
    currenciesSnapShot[data.MarketName]._id = '_' + Math.random().toString(36).substr(2, 9);
    connection.query('INSERT INTO historical SET ?', data, function (error, results, fields) {
        if (error) throw error;
    });
}

function insertIntoHistoricalForMock(resolve) {
    if (!testDatabaseData[C.mockTestCount]) {
        if (C.oneRound) {
            oneRoundFlag = true;
        } else {
            truncateForMock();
            C.mockTestCount = 0;
            console.log("(******** REPEAT ******");
            averageCache = {};
            currentPositions = [];
            copiedBuyAllocationAccountValueBtc = .200000000;
            buyAllocationAccountValueBtc = .200000000;
            currenciesSnapShot = {};
            C.globalCounter = 0;
            tradingStrategy.clearDowntrendAvg();
        }
    }

    data = testDatabaseData[C.mockTestCount];
    if (data != null) {
        currenciesSnapShot[data.MarketName] = data;
        C.mockTestCount++;
        logIt(C.mockTestCount);
        resolve(true);
        connection.query('INSERT INTO historical SET ?', data, function (error, results, fields) {
            if (error) throw error;
            resolve(true);
        });
    } else {
        resolve(true);
    }
}

function truncateForMock() {
    connection.query('TRUNCATE historical', [], function (error, results, fields) {
        if (error) throw error;
        logIt("truncated table");
    });
    connection.query('TRUNCATE positions', [], function (error, results, fields) {
        if (error) throw error;
        logIt("truncated table");
    });
}

function getMarketDataProcessor(resolve,reject) {
    if (C.mockTest) {
        if (testDatabaseData.length == 0) {
            truncateForMock();
            let query = 'SELECT MarketName, Volume,OpenBuyOrders,OpenSellOrders, BaseVolume, Last, TimeStamp, Bid, Ask, _id, unixTime FROM historical_test_'+mockTestSymbol.replace("-","")+' WHERE MarketName = ? ORDER BY unixTime ASC';
            console.log(query);
            connection.query(query, [mockTestSymbol], function (error, results, fields) {
                if (error) throw error;
                let objArray = [];
                results.forEach(function(row){
                    let obj = {};
                    row.Last = +row.Last;
                    row.Volume = +row.Volume;
                    obj.Last = row.Last;
                    obj.MarketName = row.MarketName;
                    obj.Volume = row.Volume;
                    obj.OpenBuyOrders = row.OpenBuyOrders;
                    obj.OpenSellOrders = row.OpenSellOrders;                    
                    obj.BaseVolume = row.BaseVolume;
                    obj.TimeStamp = row.TimeStamp;
                    obj.Bid = row.Bid;
                    obj.Ask = row.Ask;
                    obj._id = row._id;
                    obj.unixTime = row.unixTime;
                    objArray.push(obj);
                });
                testDatabaseData = objArray;
                //testDatabaseDataSorted = sort(testDatabaseData);
                insertIntoHistoricalForMock(resolve);
            });
        } else {
            insertIntoHistoricalForMock(resolve);
        }
    } else {
        get150BiggestCurrencies().then(function(json) {
            bittrex.getmarketsummaries(function (data) {
                if (data != null) {
                    for (let x in data.result) {
                        if (tradeAllCurrencies && data.result[x].MarketName.indexOf("BTC-") != -1 ||
                            currenciesToBeTraded.indexOf(data.result[x].MarketName) != -1) {
                            for (let y in json) {
                                if (json[y].rank < 150) {
                                    let bitrexSymbol = data.result[x].MarketName.split("-");
                                    if (json[y].symbol == bitrexSymbol[1]) {
                                        insertMarketData(data.result[x]);
                                    }
                                }

                            }
                        }
                    }
                    resolve(true);
                } else {
                    reject(true);
                    logIt("No data from bittrex. Trying again");
                    refresh();
                }

            });

        });
    }

}

// Get the 150 biggest currencies from coin market cap every 3000 seconds
function get150BiggestCurrencies() {
    let p = new Promise(function(resolve, reject) {
        if (cacheBiggestCurrencies.length == 0 || C.globalCounter % 1000 == 0) {
            fetch('https://api.coinmarketcap.com/v1/ticker/').then(function (response) {
                return response.json();
            }).then(function (json) {
                console.log("Coin Market Cap");
                cacheBiggestCurrencies = json;
                resolve(json);
            }).catch(function(e){
                console.log("Coin Market Cap Error");                
                logIt(e)
                resolve(cacheBiggestCurrencies);
            });
        } else {
            resolve(cacheBiggestCurrencies);
        }
    });
    return p;
}

function getUnixTime(timeStamp) {
    return Date.parse(timeStamp).getTime() / 1000;
}

function organizePositionsBuyPrice(marketName) {
    let mostRecentBuy = null;
    currentPositions.forEach(function(latestPosition){
        if (marketName === latestPosition.MarketName) {
            mostRecentBuy = latestPosition;
        }
    });
    return mostRecentBuy;
}

function buyLogic(data, averagePrice, averageVolume, averagePriceLastNTicks, averageVolumeLastNTicks, shortPriceLastNTicks,longerPriceLastNTicks) {
    let marketName = data.marketName;
    let currentUnixTime = data.currentUnixTime;
    let promise = null;
    let currentPosition = organizePositionsBuyPrice(marketName);
    let buySignal = tradingStrategy.strategy(data,currenciesSnapShot,currentPosition,C.trendDetectorScalar,C.minimumBaseVolume,C.superShortSMATicks,
        false,connection, averagePrice, averagePriceLastNTicks,shortPriceLastNTicks,longerPriceLastNTicks,averageCache);

    // Indicating upward trend
    // Override if the thing is going down 11-12
    let timeSinceLastSellForSymbol = Math.abs(C.globalCounter - timeSinceLastSell[marketName]);
    if ((averagePriceLastNTicks > averagePrice * C.trendDetectorScalar
        || shortPriceLastNTicks > averagePriceLastNTicks * C.buyEntryPointScalar)
        && averageVolumeLastNTicks > averageVolume * C.volumeScalar
        && averagePriceLastNTicks < shortPriceLastNTicks
        && (timeSinceLastSell[marketName] == null || timeSinceLastSellForSymbol > 100)) {
        logIt("UPWARD Trend Detected. averagePriceLast30Ticks: " + averagePriceLastNTicks  + " averagePrice: " + averagePrice + " Ticker: " + marketName + " percent:" + averagePriceLastNTicks/averagePrice);
        buySignal.buy = true;
    }
    let debug = {};

    // Need to hold any action to if there is a downward trend detected.
    let wait = false;
    if (C.mlProcessing[marketName] && C.mlProcessing[marketName].active && Math.abs(C.mlProcessing[marketName].count-C.globalCounter) < 40) {
        wait = true;
        console.log("Waiting because of an ML failure time: " + " - " + marketName + " - " + Math.abs(C.mlProcessing[marketName].count-C.globalCounter));
    } else if (C.mlProcessing[marketName]) {
        C.mlProcessing[marketName].active = false;
        C.mlProcessing[marketName].count = 0;
    }

    if (!wait) {
        if (startBuy
            && buySignal.buy
            && currenciesSnapShot[marketName].BaseVolume > C.minimumBaseVolume
            && averageVolumeLastNTicks > averageVolume * C.volumeScalar
            && (currentPosition == null || currentPosition.type === "SOLD")) {
            // BUY initial batch
            promise = buyLogicUtil(true, marketName,averagePrice,currentUnixTime,currentPosition,debug,shortPriceLastNTicks);
        } else if
            (startBuy
            && currentPosition
            && shortPriceLastNTicks > currentPosition.buyPrice * C.nBuysScalar) {
            // BUY MORE LOGIC
            promise = buyLogicUtil(false, marketName,averagePrice,currentUnixTime,currentPosition,debug,shortPriceLastNTicks);
        } else {
            // Update Average Price because it gets overwritten
            currenciesSnapShot[marketName].averagePrice = averagePrice;
        }

    }

    if (promise == null) {
        promise = new Promise(function(resolve, reject){
            resolve();
        });
    } else {
        console.log("valid buy");
    }
    
    return promise;
}

function alertUsers(subject,text) {
    if (cellNotifyEnabled) {
        mailOptions.subject = subject;
        mailOptions.html = text;
        mailOptions.text = text;
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                return console.log(error);
            }
            console.log('Message sent');
        });
    }
}

function setMlProcessingTime(marketName,active) {
    if (!C.mlProcessing[marketName]) {
        C.mlProcessing[marketName] = {count:C.globalCounter,active:active};
    }
    C.mlProcessing[marketName].active = active;
}

function buyLogicUtil(buyNew,marketName,averagePrice,currentUnixTime,currentPosition,debug) {
    console.log("Calculating average ml");
    let p = new Promise(function(resolve, reject) {
            console.log("before ml");
            getMlResponse(marketName).then(function(isBuy){
                console.log("after ml");
                console.log("ml isBuy " + isBuy);
                if (isBuy) {
                    console.log ("satisfied can buy");            
                    globalBuy = true;
                    let buyPrice = currenciesSnapShot[marketName].Ask * buyAboveAskScalar;
                    let amountToSpend = buyAllocationAccountValueBtc * buyAmount;
                    let amountOfCurrency = amountToSpend / buyPrice;
                    let costInBtc = (amountOfCurrency * buyPrice);
                    buyAllocationAccountValueBtc = buyAllocationAccountValueBtc - costInBtc;
                    currenciesSnapShot[marketName].currentBuyAllocationAccountValueBtc = buyAllocationAccountValueBtc;
                    currenciesSnapShot[marketName].timeEntered = currentUnixTime;
                    currenciesSnapShot[marketName].averagePrice = averagePrice;
                    currenciesSnapShot[marketName].costInBtc = costInBtc;
                
                    if (buyNew) {
                        logIt("BUY: " + marketName + " Last: " + currenciesSnapShot[marketName].Last + " Buy Price: " + buyPrice + " Average Price: " + averagePrice);
                        currenciesSnapShot[marketName].type = "BUY";
                    } else {
                        let moreBuy = "MORE BUY: " + marketName + " Last: " + currenciesSnapShot[marketName].Last + " Previous Price: " + currentPosition.buyPrice;
                        logIt(moreBuy);
                        alertUsers(moreBuy,moreBuy + "<a href='http://:3000/?ticker="+marketName+"&local=false'>" + marketName + " Chart </a>");
                        currenciesSnapShot[marketName].type = "MORE BUY";
                    }
                
                    // Enter Position
                    currenciesSnapShot[marketName].buyPrice = buyPrice;
                    currenciesSnapShot[marketName].amountSpent = amountToSpend;
                    currenciesSnapShot[marketName].amountOfCurrency = amountOfCurrency;
                    currenciesSnapShot[marketName].maxPrice = buyPrice;
                    currenciesSnapShot[marketName].debug = JSON.stringify(debug);
                    currenciesSnapShot[marketName].status = "open";
                    let copiedCurrentTrade = Object.assign({}, currenciesSnapShot[marketName]);        
                    currentPositions.push(copiedCurrentTrade);
                    insertHistory(copiedCurrentTrade);
                } else {
                    C.mlProcessing[marketName]  = 0;
                    console.log("NOT A BUY wait it out");
                    setMlProcessingTime(marketName,true);

                }
                console.log("ml response done");
                console.log("should go to final stage");
                resolve();
         });
    });
    return p;
}

function determineSell(data, averagePrice, averageVolume, averagePriceLastNTicks, averageVolumeLast30Ticks, longerPriceLastNTicks, shortPriceLastNTicks) {
    // Determine Sell
    let sellItems = [];
    let sellSignalList = [];
    currentPositions.forEach(function (currentPosition) {
        if (currentPosition.MarketName === data.marketName) {

            let sellSignal = tradingStrategy.strategy(data,currenciesSnapShot,currentPosition,C.trendDetectorScalar,C.minimumBaseVolume,C.superShortSMATicks,true,connection,averagePrice,averagePriceLastNTicks,shortPriceLastNTicks,longerPriceLastNTicks,averageCache);
            let currentSnapShot = currenciesSnapShot[currentPosition.MarketName];
            if (shortPriceLastNTicks > currentPosition.maxPrice) {
                currentPosition.maxPrice = shortPriceLastNTicks;
            }
            if (sellSignal.sell && sellSignalList.indexOf(currentPosition.MarketName) === -1) {
                sellSignalList.push(currentPosition.MarketName);
            }
            // logIt(sellSignalList);

            let maxPrice =  currentPosition.maxPrice;

            // Was selling out 2 quickly so taking average
            let diff = (maxPrice - shortPriceLastNTicks);
            let percentGain = diff / maxPrice;

            let lossDiff = (shortPriceLastNTicks - currentPosition.buyPrice);
            let percentLoss = diff / currentPosition.buyPrice;

            //logIt(currentPosition._id + " -- " + currentPosition.maxPrice);
            updateMaxPrice(currentPosition._id,maxPrice,data.marketName);

            let downwardTrendDetected = false;

            // Indicating downward trend. Get out!!!!!
            if (longerPriceLastNTicks < (averagePrice * C.downwardTrendDetectorScalar)) {
                downwardTrendDetected = true;
            }


            // *** Sell Logic will need to be moved out
            let debug = "";
            let isSellable = currentPosition.type != "SOLD" && currentPosition.status == "open";

            if (isSellable && sellSignal.sell) {
                let sellSignalDebug = "SELL SIGNAL " + maxPrice + " - " + currentPosition._id + " - " + percentGain;
                debug += sellSignal;
                console.log(sellSignalDebug);
            }

            let sellTriggerOne = false;
            if ((isSellable && sellSignalList.indexOf(currentPosition.MarketName) != -1)) {
                sellTriggerOne = true;
                debug += " sell trigger one";
            } else if (isSellable && shortPriceLastNTicks * C.buyEntryPointScalar < averagePriceLastNTicks) {
                sellTriggerOne = true;
            }

            let sellTriggerTwo = false;
            if (isSellable && (percentLoss < 0 && percentLoss > C.sellStopLossScalar || percentGain > C.sellGainPercentScalar)) {
                sellTriggerTwo = true;
                debug += " sell trigger two percent loss " + percentLoss + " scalar " + C.sellStopLossScalar + "percent gain " + percentGain;
            }

            if (isSellable && (sellTriggerOne || (sellSignal.sell || sellTriggerTwo))) {
                sellItems.push(currentPosition.MarketName);
                let sellPrice = currentSnapShot.Bid * sellBelowBidScalar;
                logIt("Selling " + currentPosition.MarketName + " Sell Price: " + sellPrice + " Buy Price:" + currentPosition.buyPrice);
                let gainsLoss = sellPrice * currentPosition.amountOfCurrency;
                logIt("Adding to Allocation: " + gainsLoss);
                buyAllocationAccountValueBtc += gainsLoss;
                // debug

                globalSell = true;
                currentPosition.type = "SOLD";
                currentPosition.status = "closed";
                currentPosition.TimeStamp = new Date().toISOString();
                currentPosition.unixTime = Date.now() / 1000;
                currentPosition.sellPrice = sellPrice;
                currentPosition.debug = JSON.stringify(debug);
                currentPosition.timeEntered = currentPosition.unixTime;
                timeSinceLastSell[currentPosition.MarketName] = C.globalCounter;
                // clearHistoryForTicker(currentPosition.MarketName);
                currentPosition.id = null;
                if (currentPosition._id == currenciesSnapShot[currentPosition.MarketName]._id) {
                    console.log("they are equal");
                }
                currentPosition._id = currenciesSnapShot[currentPosition.MarketName]._id;
                tradingStrategy.clearDowntrendAvg();
                let copiedCurrentTrade = Object.assign({}, currentPosition);        
                currentPositions.push(copiedCurrentTrade);                
                insertHistory(copiedCurrentTrade);
            }
        }
    });
}

function updateMaxPrice(_id,maxPrice,marketName) {
    if (C.mockTest) {
        let i = 0;
        for (;i < C.dataToProcess.length; i++) {
            let row = C.dataToProcess[i];
            if (row._id == currenciesSnapShot[marketName]._id) {
                row.maxPrice = maxPrice;
                break;
            }
        }
    } else {
        connection.query('UPDATE positions SET maxPrice = ? WHERE _id = ?', [maxPrice, _id], function (error, results, fields) {
            if (error) throw error;
        });
    }
}

function insertHistory(currentTrade) {
    console.log(currentTrade);
    connection.query('INSERT INTO positions SET ?', currentTrade, function (error, results, fields) {
        if (error) throw error;
        console.log('inserted');
    });
    connection.query('UPDATE historical SET type = ? WHERE _id = ?', [currentTrade.type, currentTrade._id], function (error, results, fields) {
        if (error) throw error;
    });
    if (C.mockTest) {
        let i = 0;
        for (;i < C.dataToProcess.length; i++) {
            let row = C.dataToProcess[i];
            if (row._id == currentTrade._id) {
                console.log(currentTrade.type + " _id " + currentTrade._id);
                row.type = currentTrade.type;
                break
            }
        }
    }
}

function calculateAveragePriceVolume(results,isVolume,userDefinedTicks,calcMaxPrice) {
    let i = 0;
    let total = 0.0;
    let maxPrice = +results[0].Last;
    let lengthOfData =  userDefinedTicks ? (results.length < userDefinedTicks ? results.length : userDefinedTicks) : results.length;
    for (; i < lengthOfData; i++) {
        let last = +results[i].Last;
        if (isVolume) {
            total +=  +results[i].Volume;
        } else {
            total += last;
        }

        if (maxPrice < last) {
            maxPrice = last;
        }
    }

    if (calcMaxPrice) {
        return maxPrice;
    } else {
        return total / lengthOfData;
    }

}

function checkPriceDataFromDatabase() {
    let checkAllPricesPromises = [];
    // Current time
    let currentUnixTime = Date.now() / 1000;
    let lastNHours = (C.howManyHoursSMA * 60 * 60 * 1000) / 1000;
    // TODO: Unit test

    let lastNHoursTime = parseInt(currentUnixTime) - parseInt(lastNHours);
    logIt("currentTime: " + currentUnixTime + " lastNHours: " + lastNHoursTime + " N = " + C.howManyHoursSMA);
    logIt("totalMlLookUps: " + totalMlLookUps);

    if (totalMlLookUps > 10000) {
        console.log("FATAL 10000 lookups");
        process.exit()
    }


    if (C.mockTest) {
        lastNHoursTime = 100000;
    }

    // Determine Buy
    for (let y in currenciesSnapShot) {
        let p = new Promise(function(resolve, reject) {
            if (C.mockTest) {
                C.dataToProcess = [];
                let internalCount = 0;

                let i = 0;

                C.dataToProcess = testDatabaseData.slice(0,C.globalCounter);
                C.dataToProcess = C.dataToProcess.reverse();
                logIt("rowCount:" + C.dataToProcess.length);
                //console.(C.dataToProcess);
                let returnData = {"marketName": mockTestSymbol, "results": C.dataToProcess, "currentUnixTime": currentUnixTime};
                resolve(returnData);
            } else {
                let query = connection.query('SELECT * FROM historical WHERE MarketName = ? AND unixTime > ? ORDER BY unixTime DESC',
                    [currenciesSnapShot[y].MarketName, lastNHoursTime], function (error, results, fields) {
                        if (error) throw error;
                        let returnData = {"marketName": y, "results": results, "currentUnixTime": currentUnixTime};
                        /*
                        results.forEach(function (row) {
                            logIt(row._id + " - " + row.unixTime);
                        });
                        */
                        resolve(returnData);
                    });
            }
        }).catch(function(e){logIt(e)});
        checkAllPricesPromises.push(p)
    }
    return checkAllPricesPromises;
}

function printStats() {
    // Need to print
    logIt("Amount Left:" + buyAllocationAccountValueBtc);
    logIt("---");
    let currentProfit = 0.0;
    let totalGainLoss = 0.0;
    let totalPortfolioValue = 0.0;
    currentPositions.forEach(function(currentPosition) {
        for (let y in currenciesSnapShot) {
            let currentSnapshot = currenciesSnapShot[y];
            // TODO: Buy more prices need extra for loop
            if (currentSnapshot.MarketName === currentPosition.MarketName && currentPosition.type !== "SOLD") {
                logIt("Market Name: "
                    + currentSnapshot.MarketName
                    + " Current Price: "
                    + currentSnapshot.Last
                    + " "
                    + currentPosition.type
                    + " Price: "
                    + currentPosition.buyPrice
                    + " Max Price: "
                    + currentPosition.maxPrice
                    + " Current Avg Price: "
                    + currentSnapshot.averagePrice
                    + " Amount: "
                    + currentPosition.amountOfCurrency
                    + " Amount Spent: "
                    + currentPosition.amountSpent
                    + " _id: "
                    + currentPosition._id);
                let diff = ((currentSnapshot.Last - currentPosition.buyPrice) * currentPosition.amountOfCurrency);
                let adjustedAmount = currentPosition.amountSpent + diff;
                let percentGain = diff / (currentPosition.buyPrice * currentPosition.amountOfCurrency);
                logIt("Gain Loss: " + diff + " percent: " + percentGain);
                logIt("---");
                totalGainLoss += adjustedAmount;
                //totalGainLoss += diff;
            }
        }
    });
    logIt("Current Allocation: " + buyAllocationAccountValueBtc);
    totalPortfolioValue = totalGainLoss + buyAllocationAccountValueBtc;
    currentProfit = (totalPortfolioValue - copiedBuyAllocationAccountValueBtc);
    logIt("Current Profit: " + currentProfit);
    logIt("Current Portfolio Value:" + totalPortfolioValue);
    profitPercentage = (currentProfit / totalPortfolioValue);
    logIt("Current Profit Percentage: " +  profitPercentage);
    logIt("---");
}


app.use(bodyParser.json());
function formatUIpayload(payload,results) {
    let i = 0;
    for (; i < results.length;i++) {
        let data = results[i];
        if (data.type == "BUY" || data.type == "MORE BUY" || data.type == "SOLD") {
            payload.trades.push([data.unixTime, data.type]);
        }
        if (i < results.length * .80) {
            if (i % 2 == 0) {
                continue;
            }
        }  
        // filter incorrect formatting of unixTimes
        payload.Last.push(data.Last);
        payload.averagePrice.push(data.averagePrice);
        payload.averageVolume.push(data.averageVolume);
        payload.averagePriceLastNTicks.push(data.averagePriceLastNTicks);
        payload.averageVolumeLastNTicks.push(data.averageVolumeLastNTicks);
        payload.longerPriceLastNTicks.push(data.longerPriceLastNTicks);
        payload.shortPriceLastNTicks.push(data.shortPriceLastNTicks);
        payload.unixTime.push(parseInt(data.unixTime));
        payload.TimeStamp.push(data.TimeStamp);
        if (data.technicalAverage == 0) {
            data.technicalAverage = null;
        }

        payload.technicalAverage.push(data.technicalAverage);
    }
    return payload;
}

app.use(express.static('public'));

app.get('/graph/:ticker', function (req, res) {
    let ticker = req.param("ticker");
    let payload = {
        Last: [],
        averagePrice: [],
        averageVolume: [],
        averagePriceLastNTicks: [],
        averageVolumeLastNTicks: [],
        longerPriceLastNTicks: [],
        shortPriceLastNTicks: [],
        TimeStamp: [],
        technicalAverage: [],
        unixTime:[],
        trades: [],
        payloadLog:globalLog
    };
    if (C.mockTest) {
        let reversedData = sort(C.dataToProcess);
        formatUIpayload(payload,reversedData);
        res.json(payload);
    } else {
        connection.query('SELECT Last,averagePrice,averageVolume,averagePriceLastNTicks,longerPriceLastNTicks,shortPriceLastNTicks,TimeStamp,technicalAverage,unixTime,type FROM historical WHERE MarketName = ? ORDER BY unixTime DESC', [ticker], function (error, results, fields) {
            if (error) throw error;
            results = sort(results);
            formatUIpayload(payload,results);
            res.json(payload);
        });
    }
});


app.listen(3000, function () {
    console.log('Server listening on', 3000)
});

tradingStrategy.instantiate(C);

function logIt(value) {
   globalLog += value + "<br>";
   console.log(value);
}


// FASTER SORTING

var sort = function(array) {
    var len = array.length;
    if(len < 2) {
        return array;
    }
    var pivot = Math.ceil(len/2);
    return merge(sort(array.slice(0,pivot)), sort(array.slice(pivot)));
};

var merge = function(left, right) {
    var result = [];
    while((left.length > 0) && (right.length > 0)) {
        if(left[0].unixTime < right[0].unixTime) {
            result.push(left.shift());
        }
        else {
            result.push(right.shift());
        }
    }
    result = result.concat(left, right);
    return result;
};
