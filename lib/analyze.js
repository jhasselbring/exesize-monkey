'use strict';

const fs = require('fs');
const path = require('path');

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const TIB = GIB * 1024;

const SIZE_TIERS = [
  { limit: 200 * MIB, label: 'under 200 MB' },
  { limit: 1 * GIB, label: '200 MB to 1 GB' },
  { limit: 5 * GIB, label: '1 GB to 5 GB' },
  { limit: 20 * GIB, label: '5 GB to 20 GB' },
  { limit: 100 * GIB, label: '20 GB to 100 GB' },
  { limit: 500 * GIB, label: '100 GB to 500 GB' },
  { limit: 2 * TIB, label: '500 GB to 2 TB' },
  { limit: Infinity, label: 'over 2 TB' }
];

const FILE_TIERS = [
  { limit: 2000, label: 'under 2k files' },
  { limit: 10000, label: '2k to 10k files' },
  { limit: 50000, label: '10k to 50k files' },
  { limit: 200000, label: '50k to 200k files' },
  { limit: 1000000, label: '200k to 1M files' },
  { limit: 5000000, label: '1M to 5M files' },
  { limit: 20000000, label: '5M to 20M files' },
  { limit: Infinity, label: 'over 20M files' }
];

const CLUSTER_SIZES = [1, 2, 3, 4, 6, 8, 12, 16];

function pickTier(value, tiers) {
  for (let i = 0; i < tiers.length; i += 1) {
    if (value < tiers[i].limit) {
      return { index: i, label: tiers[i].label, limit: tiers[i].limit };
    }
  }
  const last = tiers[tiers.length - 1];
  return { index: tiers.length - 1, label: last.label, limit: last.limit };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  let formatted;
  if (value >= 100) {
    formatted = value.toFixed(0);
  } else if (value >= 10) {
    formatted = value.toFixed(1);
  } else {
    formatted = value.toFixed(2);
  }

  return `${formatted} ${units[unitIndex]}`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

async function analyzeTarget(targetPath) {
  const stats = {
    targetPath,
    fileCount: 0,
    dirCount: 0,
    totalBytes: 0,
    largestFileBytes: 0,
    largestFilePath: '',
    skippedSymlinks: 0,
    unreadableEntries: 0
  };

  let rootStat;
  try {
    rootStat = await fs.promises.lstat(targetPath);
  } catch (error) {
    const notFound = new Error(`Target not found: ${targetPath}`);
    notFound.code = error.code;
    throw notFound;
  }

  if (rootStat.isSymbolicLink()) {
    stats.skippedSymlinks += 1;
    return stats;
  }

  if (rootStat.isFile()) {
    stats.fileCount = 1;
    stats.totalBytes = rootStat.size;
    stats.largestFileBytes = rootStat.size;
    stats.largestFilePath = targetPath;
    return stats;
  }

  if (!rootStat.isDirectory()) {
    throw new Error('Target must be a file or directory.');
  }

  const stack = [targetPath];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    stats.dirCount += 1;

    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      stats.unreadableEntries += 1;
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isSymbolicLink()) {
        stats.skippedSymlinks += 1;
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile()) {
        let fileStat;
        try {
          fileStat = await fs.promises.stat(entryPath);
        } catch (error) {
          stats.unreadableEntries += 1;
          continue;
        }

        stats.fileCount += 1;
        stats.totalBytes += fileStat.size;
        if (fileStat.size > stats.largestFileBytes) {
          stats.largestFileBytes = fileStat.size;
          stats.largestFilePath = entryPath;
        }
      }
    }
  }

  return stats;
}

function recommendClusterSize(totalBytes, fileCount) {
  const sizeTier = pickTier(totalBytes, SIZE_TIERS);
  const fileTier = pickTier(fileCount, FILE_TIERS);
  const score = Math.max(sizeTier.index, fileTier.index);
  const clusterSize = CLUSTER_SIZES[Math.min(score, CLUSTER_SIZES.length - 1)];

  let driver;
  if (sizeTier.index === fileTier.index) {
    driver = 'size and file count are equal';
  } else if (sizeTier.index > fileTier.index) {
    driver = 'size drives the recommendation';
  } else {
    driver = 'file count drives the recommendation';
  }

  return {
    clusterSize,
    score,
    sizeTier,
    fileTier,
    driver
  };
}

module.exports = {
  analyzeTarget,
  recommendClusterSize,
  formatBytes,
  formatCount
};
