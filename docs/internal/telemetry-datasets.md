# Telemetry datasets

These queries use UTC arrival time (`timestamp`) in Application Insights `customEvents`.
All event properties are stored as strings in `customDimensions`. Run each block in
Log Analytics against the production workspace before merging a telemetry release.
Counts can lag ingestion and statusline final hours can be lost. Do not put maintainer
hash values in this repository.

## Raw churn: new hashes and unavailable rows

```kql
let rows = customEvents
| extend installHash = tostring(customDimensions.installHash),
         runOrdinalBucket = tostring(customDimensions.runOrdinalBucket);
let firsts = rows
| where installHash matches regex "^[0-9a-f]{64}$"
| summarize firstSeen = min(timestamp) by installHash
| summarize newRealHashes = count() by day = startofday(firstSeen);
let quality = rows
| summarize totalRows = count(),
            ordinalRows = countif(isnotempty(runOrdinalBucket)),
            unavailableOrdinalRows = countif(runOrdinalBucket == "unavailable"),
            unavailableHashRows = countif(installHash == "unavailable" or isempty(installHash))
  by day = startofday(timestamp)
| extend unavailableOrdinalShare = todouble(unavailableOrdinalRows) / ordinalRows,
         unavailableHashShare = todouble(unavailableHashRows) / totalRows;
quality | join kind=leftouter firsts on day
| project day, newRealHashes = coalesce(newRealHashes, 0), totalRows, ordinalRows,
          unavailableOrdinalRows, unavailableOrdinalShare,
          unavailableHashRows, unavailableHashShare
| order by day asc
```

The ordinal unavailable share uses only rows carrying `runOrdinalBucket` as its
denominator. Only real 64-hex hashes enter install denominators. The unavailable hash count and
share are row-level because those rows cannot identify unique installs.

## Adoption: weekly active installs

```kql
let maintainer_hashes = dynamic([]);
let anchors = customEvents
| where name in ("cli_run", "statusline_heartbeat")
| extend installHash = tostring(customDimensions.installHash),
         isCI = tostring(customDimensions.isCI),
         os = tostring(customDimensions.os),
         runOrdinalBucket = tostring(customDimensions.runOrdinalBucket)
| where installHash matches regex "^[0-9a-f]{64}$" and isCI != "true"
| order by timestamp asc
| summarize arg_min(timestamp, os, runOrdinalBucket),
            lifetimeActiveDays = dcount(startofday(timestamp)) by installHash
| project installHash, firstSeen = timestamp, os, runOrdinalBucket, lifetimeActiveDays
| where runOrdinalBucket != "unavailable"
| where not(startofday(firstSeen) == datetime(2026-07-11) and os == "linux" and lifetimeActiveDays == 1)
| where installHash !in (maintainer_hashes);
customEvents
| where name in ("cli_run", "statusline_heartbeat")
| extend installHash = tostring(customDimensions.installHash), isCI = tostring(customDimensions.isCI)
| where isCI != "true"
| join kind=inner (anchors | project installHash) on installHash
| summarize weeklyActiveInstalls = dcount(installHash) by week = startofweek(timestamp)
| order by week asc
```

The version-matrix exclusion uses first-seen UTC day 2026-07-11, Linux, and one
lifetime active day. This predicate is applied to each adoption query below.

## Adoption: statusline install-days

```kql
let maintainer_hashes = dynamic([]);
let anchors = customEvents
| where name in ("cli_run", "statusline_heartbeat")
| extend installHash = tostring(customDimensions.installHash), isCI = tostring(customDimensions.isCI),
         os = tostring(customDimensions.os), runOrdinalBucket = tostring(customDimensions.runOrdinalBucket)
| where installHash matches regex "^[0-9a-f]{64}$" and isCI != "true"
| order by timestamp asc
| summarize arg_min(timestamp, os, runOrdinalBucket), lifetimeActiveDays = dcount(startofday(timestamp)) by installHash
| project installHash, firstSeen = timestamp, os, runOrdinalBucket, lifetimeActiveDays
| where runOrdinalBucket != "unavailable"
| where not(startofday(firstSeen) == datetime(2026-07-11) and os == "linux" and lifetimeActiveDays == 1)
| where installHash !in (maintainer_hashes);
let allHeartbeats = customEvents
| where name == "statusline_heartbeat"
| extend installHash = tostring(customDimensions.installHash),
         hourOffset = tostring(customDimensions.hourOffset), isCI = tostring(customDimensions.isCI)
| where isCI != "true"
| join kind=inner (anchors | project installHash) on installHash;
let installCounts = allHeartbeats
| summarize installCount = dcount(installHash) by day = startofday(timestamp);
let installDays = allHeartbeats
| where hourOffset != ">24"
| extend attributedHour = bin(timestamp, 1h) - toint(hourOffset) * 1h
| distinct installHash, attributedHour
| extend day = startofday(attributedHour)
| distinct installHash, day
| summarize statuslineInstallDays = count() by day;
installCounts | join kind=fullouter installDays on day
| project day = coalesce(day, day1), installCount = coalesce(installCount, 0),
          statuslineInstallDays = coalesce(statuslineInstallDays, 0)
| order by day asc
```

A `>24` heartbeat counts toward installs but cannot be placed into an hour or
an attributed day. Hourly heartbeats are deduplicated by installHash and
attributed hour before making the day series.

## Adoption: activation and power installs

```kql
let maintainer_hashes = dynamic([]);
let anchors = customEvents
| where name in ("cli_run", "statusline_heartbeat")
| extend installHash = tostring(customDimensions.installHash), isCI = tostring(customDimensions.isCI),
         os = tostring(customDimensions.os), runOrdinalBucket = tostring(customDimensions.runOrdinalBucket)
| where installHash matches regex "^[0-9a-f]{64}$" and isCI != "true"
| order by timestamp asc
| summarize arg_min(timestamp, os, runOrdinalBucket), lifetimeActiveDays = dcount(startofday(timestamp)) by installHash
| project installHash, firstSeen = timestamp, os, runOrdinalBucket, lifetimeActiveDays
| where runOrdinalBucket != "unavailable"
| where not(startofday(firstSeen) == datetime(2026-07-11) and os == "linux" and lifetimeActiveDays == 1)
| where installHash !in (maintainer_hashes);
let activity = customEvents
| where name in ("cli_run", "statusline_heartbeat")
| extend installHash = tostring(customDimensions.installHash), isCI = tostring(customDimensions.isCI)
| where isCI != "true"
| join kind=inner (anchors | project installHash) on installHash
| distinct installHash, activeDay = startofday(timestamp);
let activation = customEvents
| where name == "receipt_generated"
| extend installHash = tostring(customDimensions.installHash), isCI = tostring(customDimensions.isCI),
         toolCallCountBucket = tostring(customDimensions.toolCallCountBucket)
| where isCI != "true" and toolCallCountBucket != "0"
| join kind=inner (anchors | project installHash) on installHash
| summarize firstActivation = min(timestamp) by installHash
| summarize activatedInstalls = count() by day = startofday(firstActivation);
let days = range candidateDay from startofday(ago(90d)) to startofday(now()) step 1d
| extend joinKey = 1;
let power = activity
| extend joinKey = 1
| join kind=inner days on joinKey
| where activeDay between (candidateDay - 27d .. candidateDay)
| summarize activeDays28 = dcount(activeDay) by installHash, candidateDay
| where activeDays28 >= 5
| summarize powerInstalls = dcount(installHash) by day = candidateDay;
activation | join kind=fullouter power on day
| project day = coalesce(day, day1), activatedInstalls = coalesce(activatedInstalls, 0), powerInstalls = coalesce(powerInstalls, 0)
| order by day asc
```

## Adoption: week-over-week cohort grid

```kql
let maintainer_hashes = dynamic([]);
let anchors = customEvents
| where name in ("cli_run", "statusline_heartbeat")
| extend installHash = tostring(customDimensions.installHash), isCI = tostring(customDimensions.isCI),
         os = tostring(customDimensions.os), runOrdinalBucket = tostring(customDimensions.runOrdinalBucket)
| where installHash matches regex "^[0-9a-f]{64}$" and isCI != "true"
| order by timestamp asc
| summarize arg_min(timestamp, os, runOrdinalBucket), lifetimeActiveDays = dcount(startofday(timestamp)) by installHash
| project installHash, firstSeen = timestamp, os, runOrdinalBucket, lifetimeActiveDays
| where runOrdinalBucket != "unavailable"
| where not(startofday(firstSeen) == datetime(2026-07-11) and os == "linux" and lifetimeActiveDays == 1)
| where installHash !in (maintainer_hashes);
customEvents
| where name in ("cli_run", "statusline_heartbeat")
| extend installHash = tostring(customDimensions.installHash), isCI = tostring(customDimensions.isCI)
| where isCI != "true"
| join kind=inner (anchors | project installHash, cohortWeek = startofweek(firstSeen)) on installHash
| summarize activeInstalls = dcount(installHash) by cohortWeek, activeWeek = startofweek(timestamp)
| extend weeksSinceFirst = datetime_diff("week", activeWeek, cohortWeek)
| project cohortWeek, weeksSinceFirst, activeInstalls
| order by cohortWeek asc, weeksSinceFirst asc
```

## Reliability: errors and failed polls

```kql
let maintainer_hashes = dynamic([]);
let r2c_min_version = "0.12.0";
customEvents
| where name in ("cli_run", "cli_error", "parse_failure", "statusline_heartbeat")
| extend cliVersion = tostring(customDimensions.cliVersion), isCI = tostring(customDimensions.isCI),
         exitClass = tostring(customDimensions.exitClass),
         failedPollCountBucket = tostring(customDimensions.failedPollCountBucket),
         installHash = tostring(customDimensions.installHash)
| extend versionParts = split(cliVersion, "."), gateParts = split(r2c_min_version, ".")
| extend versionNumber = toint(versionParts[0]) * 1000000 + toint(versionParts[1]) * 1000 + toint(extract(@"^(\d+)", 1, tostring(versionParts[2]))),
         gateNumber = toint(gateParts[0]) * 1000000 + toint(gateParts[1]) * 1000 + toint(gateParts[2])
// cli_run and heartbeat have always carried isCI; the version gate only affects R2c error rows.
| where (name in ("cli_run", "statusline_heartbeat") and isCI != "true")
    or (name in ("cli_error", "parse_failure") and (versionNumber < gateNumber or isCI != "true"))
| summarize rows = count() by name, exitClass, failedPollCountBucket, cliVersion
| order by name asc, cliVersion asc
```

The maintainer is included in reliability. CI filtering on `cli_error` and
`parse_failure` begins at the R2c version. Earlier rows lack `isCI`; no claim
about their CI status is possible.

## Statusline row reduction

```kql
let r2c_min_version = "0.12.0";
let oldVersion = "0.11.0";
let rows = customEvents
| extend cliVersion = tostring(customDimensions.cliVersion),
         installHash = tostring(customDimensions.installHash),
         commandClass = tostring(customDimensions.commandClass),
         command = tostring(customDimensions.command),
         integration = tostring(customDimensions.integration)
| where installHash matches regex "^[0-9a-f]{64}$"
| where (cliVersion == r2c_min_version and ((name == "integration_surface_rendered" and integration == "statusline")
    or name == "statusline_heartbeat" or (name == "cli_error" and command == "statusline")))
    or (cliVersion == oldVersion and name == "cli_run" and commandClass == "statusline")
| summarize observedRows = count() by installHash, day = startofday(timestamp), cliVersion
| extend estimatedRows = iff(cliVersion == oldVersion, observedRows * 2, observedRows);
let matched = rows
| summarize versions = dcount(cliVersion) by installHash
| where versions == 2;
rows
| join kind=inner matched on installHash
| summarize rowsPerActiveDay = avg(estimatedRows) by installHash, cliVersion
| summarize medianRowsPerActiveDay = percentile(rowsPerActiveDay, 50) by cliVersion
| order by cliVersion asc
```

The old side doubles statusline `cli_run` rows because each v0.11.0 poll also
wrote an `integration_surface_rendered` row without an install hash. Compare
medians only for installs observed on both versions. This is an arrival-day
comparison; all days are UTC.
