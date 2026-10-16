const { AsyncLocalStorage } = require('node:async_hooks');

const scope = new AsyncLocalStorage();

function runReadOnly(work) {
  return scope.run({ readOnly: true }, work);
}

function assertWriteAllowed(operation) {
  if (scope.getStore()?.readOnly) {
    throw new Error('Shadow mode forbids mutation: ' + operation);
  }
}

module.exports = { runReadOnly, assertWriteAllowed };
