#!/usr/bin/env node
import path from 'node:path';
import {
  analyzeTarget,
  recommendClusterSize,
  formatBytes,
  formatCount
} from '../lib/analyze.js';

function printHelp() {
  console.log(`Usage: npx npx-cluster-size-suggestion [path]

Suggest a cluster size based on median file size.
If no path is provided, the current directory is used.

Options:
  -h, --help   Show help
  --           End of options`);
}

function exitWithError(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let targetArg = null;
let afterDoubleDash = false;
const unknownOptions = [];

for (const arg of args) {
  if (afterDoubleDash) {
    if (targetArg === null) {
      targetArg = arg;
    }
    continue;
  }

  if (arg === '--') {
    afterDoubleDash = true;
    continue;
  }

  if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  }

  if (arg.startsWith('-')) {
    unknownOptions.push(arg);
    continue;
  }

  if (targetArg === null) {
    targetArg = arg;
  }
}

if (unknownOptions.length > 0) {
  exitWithError(`Unknown option(s): ${unknownOptions.join(', ')}`);
}

const targetPath = path.resolve(process.cwd(), targetArg || '.');

analyzeTarget(targetPath)
  .then((stats) => {
    const recommendation = recommendClusterSize(
      stats.medianBytes,
      stats.p25Bytes,
      stats.p75Bytes
    );
    const averageBytes = stats.fileCount > 0
      ? Math.round(stats.totalBytes / stats.fileCount)
      : 0;
    const medianBytes = stats.fileCount > 0
      ? formatBytes(stats.medianBytes)
      : 'N/A';
    const rangeText = recommendation.range
      ? `${formatBytes(recommendation.range.lowBytes)} to ${formatBytes(recommendation.range.highBytes)}`
      : null;
    const clusterText = `${formatBytes(recommendation.clusterBytes)}${rangeText ? ` (range ${rangeText})` : ''}`;

    const lines = [
      `Target: ${stats.targetPath}`,
      `Files scanned: ${formatCount(stats.fileCount)} (dirs: ${formatCount(stats.dirCount)}, unreadable: ${formatCount(stats.unreadableEntries)}, skipped symlinks: ${formatCount(stats.skippedSymlinks)})`,
      `Total size: ${formatBytes(stats.totalBytes)}`,
      `Median file size: ${medianBytes}`,
      `Average file size: ${stats.fileCount > 0 ? formatBytes(averageBytes) : 'N/A'}`,
      `Largest file: ${stats.largestFilePath ? `${formatBytes(stats.largestFileBytes)} (${stats.largestFilePath})` : 'N/A'}`,
      '',
      `Suggested cluster size: ${clusterText}`,
      `Reason: ${recommendation.driver}`
    ];

    console.log(lines.join('\n'));
  })
  .catch((error) => {
    exitWithError(error.message || String(error));
  });
