import { parentPort } from 'node:worker_threads';
import { readAllSnapshot } from './all-readers.mjs';
parentPort.on('message', () => parentPort.postMessage(readAllSnapshot()));
