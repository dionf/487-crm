-- Verplichte pinwijziging bij eerste login.
--
-- Een admin typt bij het aanmaken van een gebruiker zelf de pincode in en geeft
-- die buiten het systeem door. Die startpincode is dus bij minstens twee mensen
-- bekend. Met deze vlag dwingt het CRM af dat de gebruiker na de eerste login
-- direct een eigen pincode kiest.
--
-- Default false: bestaande gebruikers merken hier niets van. De vlag wordt
-- alleen gezet bij het aanmaken van een gebruiker en wanneer een admin de
-- pincode van een ander reset.

alter table users
  add column if not exists must_change_pin boolean not null default false;
