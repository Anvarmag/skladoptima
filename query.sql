SELECT id, "actionType", "productSku", delta, "actorEmail", note, "beforeTotal", "afterTotal", "createdAt" 
FROM "AuditLog" 
WHERE "productSku" = 'M12Setka5' AND "createdAt" > '2026-03-04 20:00:00'
ORDER BY "createdAt" DESC;
