# City administration milestone

`CIVIC` is a city-owned service role, not a sprint, block type or decorative
landmark. The milestone is reached at18nonempty blocks in one city. Empty
planned blocks do not count. Existing district education/medical/fire/police
milestones and city railway/airport reservations keep their earlier priority.

The allocator reserves a compatible free building slot under the durable trigger
`city:CIVIC:18`. It never creates an ordinary task or an otherwise empty block
to hold that reservation. The next eligible user-created task consumes it.
There is one administration milestone per city, not one per sprint. Its role
and trigger persist on the task; moving/deleting leaves the existing permanent
site and must not reissue a consumed milestone during regeneration.

Migration0028extends the existing checked `tasks_v3.service_role` vocabulary.
It does not change IDs, coordinates, histories or completed task statuses.
No old-schema runtime fallback is added. Deploy the matching application and
migrations together. Reservation timing is covered by
`tests/civic-reservation.test.ts`; all roles share permanent-site lifecycle
tests and full regeneration audits.
