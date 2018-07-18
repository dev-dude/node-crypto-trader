let tickerString = window.location.search.split("=")[1];
let localBox = window.location.search.split("=")[2];

let ticker = tickerString.split("&")[0];


const highcharts = Highcharts;

let series = [
    {
        name: "Last",
        data: []
    },
    {
        name: "Average",
        data: []
    },

    {
        name: "averagePriceLastNTicks",
        data: []
    },

    {
        name: "longerPriceLastNTicks",
        data: []
    },

    {
        name: "shortPriceLastNTicks",
        data: []
    },
    {
        name: "technicalAverage",
        data: []
    }

];

let time = [];

highcharts.stockChart('container', {

    title: {
        text: ticker
    },

    yAxis: {
        title: {
            text: 'Price'
        }
    },
    xAxis: {
        title: {
            text: 'Time'
        },
        labels :{
            style:{"fontSize":"4px"}
        },
        categories: [time],
        plotLines: []
    },
    legend: {
        layout: 'vertical',
        align: 'right',
        verticalAlign: 'middle'
    },

    plotOptions: {
        series: {

        }
    },

    series: series
});


function filterNull(value) {
   return value == 0 ? null : value;
}

function getData() {
    let url = "http://localhost:3000/graph/";
    if (JSON.parse(localBox)) {
        url = "http://localhost:3000/graph/";
    }
    let i = 0;
    let y = 0;
    $.ajax({
        url: url + ticker,
        type: "GET",
        cache: false,
        success: function (data) {
            $("#bittrex-link").attr("href","https://bittrex.com/Market/Index?MarketName=" + ticker);


            let last = [];
            let averagePrice = [];
            let averagePriceLastNTicks = [];
            let longerPriceLastNTicks = [];
            let shortPriceLastNTicks = [];
            let technicalAverage = [];
            let dataError;
            for (;i < data.unixTime.length;i++) {
                let unixTime = parseInt(data.unixTime[i] + "000");
                if (JSON.parse(localBox) && data.unixTime[i] < data.unixTime[i-1]) {
                    dataError = i;
                    console.log("some sort of data error "+ dataError + " " + data.unixTime[i]);
                    continue;
                }
                last.push([unixTime,+data.Last[i]]);
                averagePrice.push([unixTime,+data.averagePrice[i]]);
                averagePriceLastNTicks.push([unixTime,+data.averagePriceLastNTicks[i]]);
                longerPriceLastNTicks.push([unixTime,+data.longerPriceLastNTicks[i]]);
                shortPriceLastNTicks.push([unixTime,+data.shortPriceLastNTicks[i]]);
                technicalAverage.push([unixTime,+data.technicalAverage[i]]);
            }

            for (;y < data.unixTime.length;y++) {
                last[y][1] = filterNull(last[y][1]);
                averagePrice[y][1] = filterNull(averagePrice[y][1]);
                averagePriceLastNTicks[y][1] = filterNull(averagePriceLastNTicks[y][1]);
                longerPriceLastNTicks[y][1] = filterNull(longerPriceLastNTicks[y][1]);
                shortPriceLastNTicks[y][1] = filterNull(shortPriceLastNTicks[y][1]);
                technicalAverage[y][1] = filterNull(technicalAverage[y][1]);
            }

            highcharts.charts[0].series[0].setData(last);
            highcharts.charts[0].series[1].setData(averagePrice);
            highcharts.charts[0].series[2].setData(averagePriceLastNTicks);
            highcharts.charts[0].series[3].setData(longerPriceLastNTicks);
            highcharts.charts[0].series[4].setData(shortPriceLastNTicks);
            highcharts.charts[0].series[5].setData(technicalAverage);
            highcharts.charts[0].xAxis[0].update({categories:data.unixTime});

            let z = 0;
            let plotLines = [];
            for (; z < data.trades.length; z++) {
                let plotLine;
                if (data.trades[z][1] == "BUY") {
                    plotLine = formatPlotLines("BUY","black", data.trades[z][0] + "000");
                } else if (data.trades[z][1] == "MORE BUY") {
                    plotLine = formatPlotLines("MORE BUY","green", data.trades[z][0] + "000");
                } else if (data.trades[z][1] == "SOLD") {
                    plotLine = formatPlotLines("SOLD","red",data.trades[z][0] + "000");
                }
                highcharts.charts[0].xAxis[0].addPlotLine(plotLine);

            }
            if (data.payloadLog.length > 70) {
                $("#status").html(data.payloadLog);
            }
            setTimeout(function(){
                getData();                
            },3000)
        }
    });
}

function formatPlotLines(type,color,time) {
    let plotLine = {
    value: +time,
        width: 1,
        color: color,
        dashStyle: 'dash',
        label: {
        text: type,
            align: 'right',
            y: 12,
            x: 0
        }
    };
    return plotLine;
}

let defaultInterval = 5000;
if (JSON.parse(localBox)) {
    defaultInterval = 1000;
}
getData();


