var path = require('path');
var webpack = require('webpack');

module.exports = {
    target: 'node',
    entry: './lib/box-node-sdk.js',
    output: {
        path: path.resolve(__dirname, 'build'),
        filename: 'bundle.js'
    },
    module: {
        rules: [{
            test: /\.(js)$/,
            //exclude: /node_modules/,
            use: [
                'babel-loader',
            ],
        }]
    },
    stats: {
        colors: true
    },
    devtool: 'source-map'
}