/**
 * @fileoverview Upload manager for large file uploads
 */

'use strict';

// -----------------------------------------------------------------------------
// Typedefs
// -----------------------------------------------------------------------------

/**
 * Chunk uploaded event
 * @event Chunk#uploaded
 * @param {UploadPart} data The data of the uploaded chunk
 * @private
 */

/**
 * Chunk error event
 * @event Chunk#error
 * @param {Error} err The error that occurred
 * @private
 */

/**
 * Event for when the upload is successfully aborted
 * @event ChunkedUploader#aborted
 */

/**
 * Event for when the abort fails because the upload session is not destroyed.
 * In general, the abort can be retried, and no new chunks will be uploaded.
 * @event ChunkedUploader#abortFailed
 * @param {Error} err The error that occurred
 */

/**
 * Event for when a chunk fails to upload.  Note that the chunk will automatically
 * retry until it is successfully uploaded.
 * @event ChunkedUploader#chunkError
 * @param {Error} err The error that occurred during chunk upload
 */

/**
 * Event for when a chunk is successfully uploaded
 * @event ChunkedUploader#chunkUploaded
 * @param {UploadPart} data The data for the uploaded chunk
 */

/**
 * Event for when the entire upload is complete
 * @event ChunkedUploader#uploadComplete
 * @param {Object} file The file object for the newly-uploaded file
 */

/**
 * Event for when an upload fails
 * @event ChunkedUploader#error
 * @param {Error} err The error that occurred
 */

// -----------------------------------------------------------------------------
// Requirements
// -----------------------------------------------------------------------------

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EventEmitter = require('events').EventEmitter,
    ReadableStream = require('stream').Readable,
    crypto = require('crypto');

// -----------------------------------------------------------------------------
// Private
// -----------------------------------------------------------------------------

var DEFAULT_OPTIONS = Object.freeze({
	parallelism: 4,
	retryInterval: 1000
});

/**
 * Chunk of a file to be uploaded, which handles trying to upload itself until
 * it succeeds.
 * @private
 */

var Chunk = function (_EventEmitter) {
	_inherits(Chunk, _EventEmitter);

	/**
  * Create a Chunk, representing a part of a file being uploaded
  * @param {BoxClient} client The Box SDK client
  * @param {string} sessionID The ID of the upload session the chunk belongs to
  * @param {Buffer|string} chunk The chunk that was uploaded
  * @param {int} offset The byte offset within the file where this chunk begins
  * @param {int} totalSize The total size of the file this chunk belongs to
  * @param {Object} options The options from the ChunkedUploader
  * @param {int} options.retryInterval The number of ms to wait before retrying a chunk upload
  */
	function Chunk(client, sessionID, chunk, offset, totalSize, options) {
		_classCallCheck(this, Chunk);

		var _this = _possibleConstructorReturn(this, (Chunk.__proto__ || Object.getPrototypeOf(Chunk)).call(this));

		_this.client = client;
		_this.sessionID = sessionID;
		_this.chunk = chunk;
		_this.length = chunk.length;
		_this.offset = offset;
		_this.totalSize = totalSize;
		_this.options = options;
		_this.data = null;
		_this.retry = null;
		_this.canceled = false;
		return _this;
	}

	/**
  * Get the final object representation of this chunk for the API
  * @returns {UploadPart} The chunk object
  */


	_createClass(Chunk, [{
		key: 'getData',
		value: function getData() {

			return this.data.part;
		}

		/**
   * Upload a chunk to the API
   * @returns {void}
   * @emits Chunk#uploaded
   * @emits Chunk#error
   */

	}, {
		key: 'upload',
		value: function upload() {
			var _this2 = this;

			this.client.files.uploadPart(this.sessionID, this.chunk, this.offset, this.totalSize, function (err, data) {

				if (_this2.canceled) {
					_this2.chunk = null;
					return;
				}

				if (err) {
					// handle the error or retry
					if (err.statusCode) {
						// an API error, probably not retryable!
						_this2.emit('error', err);
					} else {
						// maybe a network error, retry
						_this2.retry = setTimeout(function () {
							return _this2.upload();
						}, _this2.options.retryInterval);
					}
					return;
				}

				// Record the chunk data for commit, and try to free up the chunk buffer
				_this2.data = data;
				_this2.chunk = null;
				_this2.emit('uploaded', data);
			});
		}

		/**
   * Cancel trying to upload a chunk, preventing it from retrying and clearing
   * the associated buffer
   * @returns {void}
   */

	}, {
		key: 'cancel',
		value: function cancel() {

			clearTimeout(this.retry);
			this.chunk = null;
			this.canceled = true;
		}
	}]);

	return Chunk;
}(EventEmitter);

// -----------------------------------------------------------------------------
// Public
// -----------------------------------------------------------------------------

/** Manager for uploading a file in chunks */


var ChunkedUploader = function (_EventEmitter2) {
	_inherits(ChunkedUploader, _EventEmitter2);

	/**
  * Create an upload manager
  * @param {BoxClient} client The client to use to upload the file
  * @param {Object} uploadSessionInfo The upload session info to use for chunked upload
  * @param {ReadableStream|Buffer|string} file The file to upload
  * @param {int} size The size of the file to be uploaded
  * @param {Object} [options] Optional parameters
  * @param {int} [options.retryInterval=1000] The number of ms to wait before retrying operations
  * @param {int} [options.parallelism=4] The number of concurrent chunks to upload
  */
	function ChunkedUploader(client, uploadSessionInfo, file, size, options) {
		_classCallCheck(this, ChunkedUploader);

		var _this3 = _possibleConstructorReturn(this, (ChunkedUploader.__proto__ || Object.getPrototypeOf(ChunkedUploader)).call(this));

		_this3._client = client;
		_this3._sessionID = uploadSessionInfo.id;
		_this3._partSize = uploadSessionInfo.part_size;
		_this3._uploadSessionInfo = uploadSessionInfo;

		if (file instanceof ReadableStream) {
			// Pause the stream so we can read specific chunks from it
			_this3._stream = file.pause();
			_this3._streamBuffer = [];
		} else if (file instanceof Buffer || typeof file === 'string') {
			_this3._file = file;
		} else {
			throw new TypeError('file must be a Stream, Buffer, or string!');
		}

		_this3._size = size;
		_this3._options = Object.assign({}, DEFAULT_OPTIONS, options);

		_this3._isStarted = false;
		_this3._numChunksInFlight = 0;
		_this3._chunks = [];
		_this3._position = 0;
		_this3._fileHash = crypto.createHash('sha1');
		return _this3;
	}

	/**
  * Start an upload
  * @returns {void}
  */


	_createClass(ChunkedUploader, [{
		key: 'start',
		value: function start() {
			var _this4 = this;

			if (this._isStarted) {
				return;
			}

			// Create the initial chunks
			for (var i = 0; i < this._options.parallelism; i++) {
				this._getNextChunk(function (chunk) {
					return chunk ? _this4._uploadChunk(chunk) : _this4._commit();
				});
			}
			this._isStarted = true;
		}

		/**
   * Abort a running upload, which cancels all currently uploading chunks,
   * attempts to free up held memory, and aborts the upload session.  This
   * cannot be undone or resumed.
   * @returns {void}
   * @emits ChunkedUploader#aborted
   * @emits ChunkedUploader#abortFailed
   */

	}, {
		key: 'abort',
		value: function abort() {
			var _this5 = this;

			this._chunks.forEach(function (chunk) {
				return chunk.removeAllListeners().cancel();
			});
			this._chunks = [];
			this._file = null;
			this._stream = null;

			this._client.files.abortUploadSession(this._sessionID, function (err) {

				if (err) {
					_this5.emit('abortFailed', err);
					return;
				}

				_this5.emit('aborted');
			});
		}

		/**
   * Get the next chunk of the file to be uploaded
   * @param {Function} callback Called with the next chunk of the file to be uploaded
   * @returns {void}
   * @private
   */

	}, {
		key: '_getNextChunk',
		value: function _getNextChunk(callback) {
			var _this6 = this;

			if (this._position >= this._size) {
				callback(null);
				return;
			}

			var buf = void 0;

			if (this._file) {

				// Buffer/string case, just get the slice we need
				buf = this._file.slice(this._position, this._position + this._partSize);
			} else if (this._streamBuffer.length > 0) {

				buf = this._streamBuffer.shift();
			} else {

				// Stream case, need to read
				buf = this._stream.read(this._partSize);

				if (!buf) {
					// stream needs to read more, retry later
					setImmediate(function () {
						return _this6._getNextChunk(callback);
					});
					return;
				} else if (buf.length > this._partSize) {

					// stream is done reading and had extra data, buffer the remainder of the file
					for (var i = 0; i < buf.length; i += this._partSize) {

						this._streamBuffer.push(buf.slice(i, i + this._partSize));
					}
					buf = this._streamBuffer.shift();
				}
			}

			this._fileHash.update(buf);
			var chunk = new Chunk(this._client, this._sessionID, buf, this._position, this._size, this._options);
			this._position += buf.length;
			callback(chunk);
		}

		/**
   * Upload a chunk
   * @param {Chunk} chunk The chunk to upload
   * @returns {void}
   * @emits ChunkedUploader#chunkError
   * @emits ChunkedUploader#chunkUploaded
   */

	}, {
		key: '_uploadChunk',
		value: function _uploadChunk(chunk) {
			var _this7 = this;

			this._numChunksInFlight += 1;

			chunk.on('error', function (err) {
				return _this7.emit('chunkError', err);
			});
			chunk.on('uploaded', function (data) {

				_this7._numChunksInFlight -= 1;

				_this7.emit('chunkUploaded', data);
				_this7._getNextChunk(function (nextChunk) {
					return nextChunk ? _this7._uploadChunk(nextChunk) : _this7._commit();
				});
			});
			chunk.upload();
			this._chunks.push(chunk);
		}

		/**
   * Commit the upload, finalizing it
   * @returns {void}
   * @emits ChunkedUploader#uploadComplete
   * @emits ChunkedUploader#error
   */

	}, {
		key: '_commit',
		value: function _commit() {
			var _this8 = this;

			if (!this._isStarted || this._numChunksInFlight > 0) {
				return;
			}

			var hash = this._fileHash.digest('base64');
			this._isStarted = false;
			var options = {
				parts: this._chunks.map(function (c) {
					return c.getData();
				})
			};
			this._client.files.commitUploadSession(this._sessionID, hash, options, function (err, file) {

				// It's not clear what the SDK can do here, so we just return the error and session info
				// so users can retry if they wish
				if (err) {
					_this8.emit('error', {
						uploadSession: _this8._uploadSessionInfo,
						error: err
					});
					return;
				}

				_this8.emit('uploadComplete', file);
			});
		}
	}]);

	return ChunkedUploader;
}(EventEmitter);

module.exports = ChunkedUploader;