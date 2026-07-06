const { Queue } = require('bullmq');
const { getBullMQClient } = require('../cache/redis');
const logger = require('../utils/logger');

const QUEUE_NAME = 'cpa-media-ingest';
let _queue = null;

function getQueue() {
  if (_queue) return _queue;
  _queue = new Queue(QUEUE_NAME, {
    connection: getBullMQClient(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // ── Remove jobs immediately after done — saves storage
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  _queue.on('error', err => logger.error('[queue] BullMQ error', { error: err.message }));
  logger.info('[queue] Queue initialised', { name: QUEUE_NAME });
  return _queue;
}

async function enqueueExtraction(payload) {
  const job = await getQueue().add('extract', payload, { jobId: payload.jobId });
  logger.info('[queue] Job enqueued', { jobId: payload.jobId, url: payload.url });
  return job;
}

module.exports = { getQueue, enqueueExtraction, QUEUE_NAME };
