let downtrendSimpleMovingAverage = {};
let C = {};

module.exports = {
    instantiate: function(config) {
        C = config;
    },
    clearDowntrendAvg: function(config) {
        downtrendSimpleMovingAverage = {};
    },
    strategy: function(data,currenciesSnapShot,currentPosition,trendDetectorScalar,minimumBaseVolume,superShortSMATicks,sell,connection,averagePrice,averagePriceLastNTicks,shortPriceLastNTicks,longerPriceLastNTicks,averageCache)  {
        // Total Average Price
        let superShortAveragePrice = shortPriceLastNTicks;
        let price100LastNTicks  = averagePriceLastNTicks;

        let buySell = {buy:false,sell:false};
        let logicGate1 = false;
        let logicGate2 = false;
        let logicGate3 = false;
        let technicalAverage = 0;

        // A short term avg (avoids misprints) has went above or below the avg price a buying opportunity
        if (data.results[0] && buyOrSellLogicGate1(sell,superShortAveragePrice,price100LastNTicks,downtrendSimpleMovingAverage,data.marketName)) {
            //console.log("Logic gate 1 buy: " + sell + " :" + data.marketName);
            if (sell) {
                //console.log("sell1");
            }
            logicGate1 = true;
            downtrendSimpleMovingAverage[data.marketName] = {counter: 1, collect: true, results: [{Last:superShortAveragePrice}], average: superShortAveragePrice, ids:[], activated: false}
        } else if (buyOrSellLogicGate2(superShortAveragePrice,price100LastNTicks,sell)
            && downtrendSimpleMovingAverage[data.marketName] != null) {

            // Don't buy if the long term average is pointing down too much. A safeguard
            let averages = averageCache[data.marketName].avg;
            let averageDirection = (averages[averages.length-1] - averages[0]) / averages[0];
            if (!sell && averageDirection < -.01) {
                return buySell;
            }

            //console.log("Logic gate 2 buy: " + sell + " :" + data.marketName);
            logicGate2 = true;
            let updateCurrentAverage = downtrendSimpleMovingAverage[data.marketName];
            updateCurrentAverage.activated = true;
            if (superShortAveragePrice != undefined) {
                updateCurrentAverage.ids.push(data.results[0]._id);
                updateCurrentAverage.results.push({Last: superShortAveragePrice});
            }
            updateCurrentAverage.counter++;


            updateCurrentAverage.average = calculateAveragePriceVolume(updateCurrentAverage.results, false, updateCurrentAverage.counter);
            technicalAverage = updateCurrentAverage.average;
        } else {
            delete downtrendSimpleMovingAverage[data.marketName];
        }

        let updateCurrentAverage = downtrendSimpleMovingAverage[data.marketName];
        // on the way up or down :)
        // This 40 may be the most important metric


        if (updateCurrentAverage != null
            && buyOrSellLogicGate3(sell,updateCurrentAverage,updateCurrentAverage.average,superShortAveragePrice)) {
            //console.log("Logic gate 3 buy: " + sell + " :" + data.marketName);
            logicGate3 = true;
            if (sell) {
                buySell.sell = true;
            } else {
                buySell.buy = true;
            }
            delete downtrendSimpleMovingAverage[data.marketName];

            //console.log("deleted");

        }

        let p = new Promise(function(resolve, reject) {
            insertTradingStrategy(logicGate1,logicGate2,logicGate3,technicalAverage,currenciesSnapShot,data.marketName,connection).then(function(){
                resolve(buySell);
            });
        });

        return p;
    }
};

function insertTradingStrategy(logicGate1,logicGate2,logicGate3,technicalAverage,currenciesSnapShot,marketName,connection) {
    let p = new Promise(function(resolve, reject) {
        if (C.mockTest) {
            let i = C.dataToProcess.length - 1;
            for (;0 <= i; i--) {
                let row = C.dataToProcess[i];
                if (row._id == currenciesSnapShot[marketName]._id) {
                    row.logicGate1 = logicGate1;
                    row.logicGate2 = logicGate2;
                    row.logicGate3 = logicGate3;
                    row.technicalAverage = technicalAverage;
                    break;
                }
            }
            resolve();
        } else {
            connection.query('UPDATE historical SET logicGate1 = ?, logicGate2 = ?, logicGate3 = ?, technicalAverage = ? ' +
                'WHERE _id = ?', [logicGate1,logicGate2,logicGate3,technicalAverage,currenciesSnapShot[marketName]._id], function (error, results, fields) {
                    resolve();
            });
        }
    });
    return p;
}

function buyOrSellLogicGate1(sell,superShortAveragePrice,longerPriceLastNTicks,downtrendSimpleMovingAverage,marketName) {
    let indicator = false;
    if (!sell && superShortAveragePrice < longerPriceLastNTicks * C.startAvgBuyScalar && downtrendSimpleMovingAverage[marketName] == null) {
        indicator = true;
    } else if (sell && superShortAveragePrice > longerPriceLastNTicks * C.startAvgSellScalar && downtrendSimpleMovingAverage[marketName] == null) {
        indicator = true;
    }
    return indicator;
}

function buyOrSellLogicGate2(superShortAveragePrice,longerPriceLastNTicks, sell) {
    let indicator = false;
    let calc = (superShortAveragePrice - longerPriceLastNTicks)/longerPriceLastNTicks;

    if (!sell && Math.abs(calc) < C.logicGate2SnapbackBuy) {
        indicator = true;
    } else if (calc < C.logicGate2SnapbackBuy) {
        indicator = true;
    }
    return indicator;
}

// Update 11-01 - 200 to start considering to buy. Removed this from sell because it wasnt selling on a drop.
function buyOrSellLogicGate3(sell,updateCurrentAverage,updateCurrentAverageAvg,superShortAveragePrice) {
    let indicator = false;
    if (!sell && updateCurrentAverage.counter > C.whenToStartAvgCheck && updateCurrentAverage != null && updateCurrentAverageAvg * C.buyEntryPointScalar < superShortAveragePrice) {
        indicator = true;
    } else if (sell && updateCurrentAverage != null && updateCurrentAverageAvg > superShortAveragePrice * C.logicGate3SellScalar) {
        // console.log("sell3");
        indicator = true;
    }
    return indicator;
}

function calculateAveragePriceVolume(results,isVolume,userDefinedTicks) {
    let i = 0;
    let total = 0.0;
    let lengthOfData =  userDefinedTicks ? (results.length < userDefinedTicks ? results.length : userDefinedTicks) : results.length;
    for (; i < lengthOfData; i++) {
        if (isVolume) {
            total +=  results[i].Volume;
        } else {
            total += results[i].Last;
        }
    }
    return total / lengthOfData;
}
