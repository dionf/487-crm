-- Migration: HipHot Terugbellen tussenstatus
-- Date: 2026-04-07
-- Description: Verplaatst leads met call_outcome 'terugbellen_5_dagen' of 'geen_gehoor_terugbellen'
--              naar de nieuwe 'terugbellen' status (alleen HipHot tenant)

UPDATE leads
SET status = 'terugbellen'
WHERE tenant = 'hiphot'
  AND call_outcome IN ('terugbellen_5_dagen', 'geen_gehoor_terugbellen')
  AND status = 'nieuwe_aanvraag';
