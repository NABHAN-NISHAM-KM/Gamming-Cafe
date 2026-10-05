-- Detected peripherals are identified by vendor + product + kind instead of the
-- Windows instance path, which changes when a device moves to another USB port
-- (the same receiver was listed twice: connected, and "missing").

-- Built into the PC (I2C touchpads/keyboards: HID without a vendor id) — not customer gear.
DELETE FROM "DeviceAccessory"
WHERE "hardwareId" IS NOT NULL
  AND left(upper("hardwareId"), 4) = 'HID\'
  AND upper("hardwareId") !~ 'VID_[0-9A-F]{4}&PID_[0-9A-F]{4}'
  AND upper("hardwareId") !~ 'VID&[0-9A-F]{8}_PID&[0-9A-F]{4}';

CREATE TEMP TABLE peripheral_key AS
SELECT id, "deviceId", connected, "lastSeenAt",
       COALESCE(
         (SELECT 'VID_' || m[1] || '&PID_' || m[2] FROM regexp_match(upper("hardwareId"), 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') AS m),
         (SELECT 'VID_' || m[1] || '&PID_' || m[2] FROM regexp_match(upper("hardwareId"), 'VID&[0-9A-F]{4}([0-9A-F]{4})_PID&([0-9A-F]{4})') AS m),
         upper("hardwareId")
       ) || ':' || type::text AS key
FROM "DeviceAccessory"
WHERE "hardwareId" IS NOT NULL;

-- One row per physical device: keep the connected / most recently seen one.
DELETE FROM "DeviceAccessory" a
USING (
  SELECT id, row_number() OVER (PARTITION BY "deviceId", key ORDER BY connected DESC, "lastSeenAt" DESC NULLS LAST, id) AS n
  FROM peripheral_key
) d
WHERE a.id = d.id AND d.n > 1;

UPDATE "DeviceAccessory" a SET "hardwareId" = k.key
FROM peripheral_key k
WHERE a.id = k.id AND a."hardwareId" IS DISTINCT FROM k.key;

DROP TABLE peripheral_key;
