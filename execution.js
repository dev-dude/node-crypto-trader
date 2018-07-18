let C = {};
let bit;
let currentBalance = 0;
var Promise = require('bluebird');

module.exports = {
    instantiate: function(config,bita) {
        bit = bita;
        C = config;
    },
    b: function(marketName,rate,quantity,exceedingOpenPositions) {       
        let p = new Promise(function(resolve, reject) {
            if (C.allowBuys && !exceedingOpenPositions) {
                bit.buylimit({market:marketName,rate:rate,quantity:quantity}, function( data, err ) {
                    if (err) {
                        console.error(err);
                    }
                    if (data && data.result && data.result.uuid && data.success) {
                        console.log("*** Sucessful BUY Preliminary *** ");
                        resolve({"msg":data.message,"uuid":data.result.uuid,"success":data.success});
                    } else {
                        console.log("*** NOT sucessful Buy *** ");
                        resolve({"msg":"fail","uuid":000000,"success":false});

                    }
                });
            } else {
                console.log("*** BUYs disabled *** ");
                resolve({"msg":"disabled","uuid":"12312","success":"true"});
            }
        });
        return p;
    },
    s: function(marketName,rate,quantity)  {
        let p = new Promise(function(resolve, reject) {
            if (C.allowSells) {
                bit.selllimit({market:marketName,rate:rate,quantity:quantity}, function( data, err ) {
                    if (err) {
                        console.error(err);
                    }
                    if (data && data.result && data.result.uuid && data.success) {
                        console.log("*** Sucessful Sell Preliminary *** ");
                        resolve({"msg":data.message,"uuid":data.result.uuid,"success":data.success});
                    } else {
                        console.log("*** NOT sucessful Sell *** ");
                        resolve({"msg":"fail","uuid":000000,"success":false});
                    }
                });
            } else {
                console.log("*** Sells disabled *** ");
                resolve({"msg":"disabled","uuid":"12312","success":"true"});
            }
        });
        return p;
    },
    ba: function() {
        let p = new Promise(function(resolve, reject) {
            bit.getbalances(function( data, err ) {
                if (err) {
                  console.error(err);
                }
                if (data.result) {
                    let i = 0;
                    let btcAmount = 0;
                    for (;i < data.result.length;i++) {
                        let curCur = data.result[i];
                        /*
                        console.log("Bal cur " + curCur.Currenc +  " bal: " + curCur.Balance 
                        + " avail: " + curCur.Available + " pending: " + curCur.Pending);
                        totals += data.result[i].Balance;
                        */
                        if (curCur.Currency == "BTC") {
                            btcAmount = curCur.Balance;
                        }
                    }
                    console.log("** Total Online BTC ** : " + btcAmount);
                    resolve({result:data.result,btc:btcAmount});
                } else {
                    console.log("error get balance");
                    resolve({result:[],btc:0});
                }
            });
        });
        return p;
    },
    orHis: function() {
        let p = new Promise(function(resolve, reject) {
            bit.getorderhistory({},function( data, err ) {
                if (err) {
                    console.error(err);
                }
                console.log("Order History:")
                if (data.result) {
                    let i = 0;
                    let totals = 0;
                    for (;i < data.result;i++) {
                        let curCur = data.result[i];
                        console.log("exchange  " + curCur.Exchange +  " type: " + curCur.Type +  " limit: " + curCur.Limit +  " price: " + curCur.Price + " quant: "
                        + curCur.Quantity + " quant remaing: " + curCur.QuantityRemaining + "commision: " + curCur.Commission);
                        totals += data.result[i].Balance;
                    }
                    resolve(data.result);
                } else {
                    console.log("error get balance");
                    resolve({});
                }
            });
        });
        return p;
    },
    openOrders: function() {
        let p = new Promise(function(resolve, reject) {
            if (C.openOrdersEndpoint) {
                bit.getopenorders({},function(data,err) {
                    if (err) {
                        console.error(err);
                    }
                    console.log("Open Orders:")
                    if (data && data.result) {
                        resolve(data.result);
                    } else {
                        console.log("error get openOrders");
                        resolve({});
                    }
                });
            } else {
                resolve({});
            }
        });
        return p;
    }
};
