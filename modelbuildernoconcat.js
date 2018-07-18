const mysql  = require('mysql');
const AWS = require('aws-sdk');
const fs = require('fs');
const fastcsv = require('fast-csv');
AWS.config.update({ accessKeyId: '', secretAccessKey: '' });
let connection = mysql.createConnection({
    host     : '',
    user     : '',
    password : '',
    database : ''
});  
const s3 = new AWS.S3({ signatureVersion: 'v4' });

let allActiveSymbols = [];
let activeIndex = 0;
connection.query('SELECT DISTINCT MarketName from historical', {}, function (error, results, fields) {
    if (error) throw error;
    let i = 0;
    for (; i < results.length;i++){
        allActiveSymbols.push(results[i].MarketName);
    }
    console.log("got " + allActiveSymbols.length);
    dumpDatatoS3();
});

function dumpDatatoS3() {
    if (!allActiveSymbols[activeIndex]) {
        connection.end();	
        uploadtoS3();	        
    } else {
        let query = 'SELECT (Last / (SELECT MIN(Last) FROM historical WHERE MarketName = "'+allActiveSymbols[activeIndex]+'")) as lastPercent,(BaseVolume / (SELECT MIN(BaseVolume) FROM historical WHERE MarketName = "'+allActiveSymbols[activeIndex]+'"))'+
        ' as volumePercent,(OpenBuyOrders/OpenSellOrders) as buyToSellPercent, (1-(Ask - Bid)/Ask) as spreadPercent FROM historical WHERE MarketName = "'+allActiveSymbols[activeIndex]+'"';
        console.log("query" + query); 
        let queryIt = connection.query(query, function(err, rows){
            console.log("got data");
            if(err) throw err;
            let row = [];        
            let result = [];
            let text = '[';
            let i = 0;
            for (; i < rows.length; i++) {
                row[i] = JSON.stringify(rows[i]);
                result.push(row[i]);
                if (i == rows.length - 1) {
                    text += result[i];
                } else {
                    text += result[i] + ',';
                }
            }	
            text += ']';
            let data = JSON.parse(text);
            let ws = fs.createWriteStream('/dumps/' + allActiveSymbols[activeIndex] + '.csv');
            fastcsv.write(data, {headers: true})
                .pipe(ws);
                ws.on("finish", function(){
                    console.log("finished: " + allActiveSymbols[activeIndex] + " active index " + activeIndex);
                    activeIndex++;
                    dumpDatatoS3();         
                });
        });
    }
}

function uploadtoS3() {
    fs.readdir("/dumps", (err, files) => {    
      for (const fileName of files) {
        const filePath = "/dumps/" + fileName;
        if (fs.lstatSync(filePath).isDirectory()) {
          continue;
        }
        fs.readFile(filePath, (error, fileContent) => {
          if (error) { throw error; }
    
          // upload file to S3
          s3.putObject({
            Bucket: "stockuploads",
            Key: fileName,
            Body: fileContent
          }, (res) => {
            console.log(`Successfully uploaded '${fileName}'!`);
          });
    
        });
      }
    });
}
