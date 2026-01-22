import fs from 'node:fs';
import path from 'node:path';

const KIB = 1024;
const MIB = KIB * 1024;

const CLUSTER_BYTES = [
  4 * KIB,
  8 * KIB,
  16 * KIB,
  32 * KIB,
  64 * KIB,
  128 * KIB,
  256 * KIB,
  512 * KIB,
  1 * MIB
];

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

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) {
    return 0;
  }
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const index = (sortedValues.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function pickClusterIndex(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  for (let i = 0; i < CLUSTER_BYTES.length; i += 1) {
    const size = CLUSTER_BYTES[i];
    if (value === size) {
      return i;
    }
    if (value < size) {
      return Math.max(0, i - 1);
    }
  }

  return CLUSTER_BYTES.length - 1;
}

async function analyzeTarget(targetPath) {
  const stats = {
    targetPath,
    fileCount: 0,
    dirCount: 0,
    totalBytes: 0,
    medianBytes: 0,
    p25Bytes: 0,
    p75Bytes: 0,
    largestFileBytes: 0,
    largestFilePath: '',
    skippedSymlinks: 0,
    unreadableEntries: 0
  };
  const fileSizes = [];

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
    stats.medianBytes = rootStat.size;
    stats.p25Bytes = rootStat.size;
    stats.p75Bytes = rootStat.size;
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
        fileSizes.push(fileStat.size);
        if (fileStat.size > stats.largestFileBytes) {
          stats.largestFileBytes = fileStat.size;
          stats.largestFilePath = entryPath;
        }
      }
    }
  }

  if (fileSizes.length > 0) {
    fileSizes.sort((a, b) => a - b);
    stats.medianBytes = percentile(fileSizes, 0.5);
    stats.p25Bytes = percentile(fileSizes, 0.25);
    stats.p75Bytes = percentile(fileSizes, 0.75);
  }

  return stats;
}

function recommendClusterSize(medianBytes, p25Bytes, p75Bytes) {
  const clusterIndex = pickClusterIndex(medianBytes);
  const clusterBytes = CLUSTER_BYTES[clusterIndex];
  const heterogenous = p25Bytes > 0
    && p75Bytes > 0
    && p75Bytes / p25Bytes >= 4;
  let range = null;

  if (heterogenous) {
    const lowIndex = pickClusterIndex(p25Bytes);
    const highIndex = pickClusterIndex(p75Bytes);
    if (lowIndex !== highIndex) {
      range = {
        lowBytes: CLUSTER_BYTES[lowIndex],
        highBytes: CLUSTER_BYTES[highIndex],
        lowIndex,
        highIndex
      };
    }
  }

  return {
    clusterBytes,
    clusterIndex,
    medianBytes,
    p25Bytes,
    p75Bytes,
    range,
    driver: 'median file size drives cluster size recommendation.'
  };
}

export {
  analyzeTarget,
  recommendClusterSize,
  formatBytes,
  formatCount
};
