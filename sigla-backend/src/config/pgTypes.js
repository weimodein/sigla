// Read "timestamp without time zone" values as UTC, whatever the machine's own time zone.
//
// Every timestamp column here holds UTC (Sequelize writes UTC) but has no zone
// attached, and pg parses such a value as LOCAL time. On a server running in UTC
// that is the same thing, which is why production never showed a problem; on a
// laptop in UTC+8 every created_at came back 8 hours early. Required by db.js
// before any query runs. Type 1114 = timestamp without time zone.
const { types } = require("pg");

types.setTypeParser(1114, (value) => new Date(`${value.replace(" ", "T")}Z`));
