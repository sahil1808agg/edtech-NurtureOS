-- Extract now sends the whole multi-page PDF in a single model call instead
-- of one call per page (see docs/engineering/low-level-design.md, "Extract —
-- whole report"). extractions.page_no can no longer be a required per-row
-- key — one row is written per report, holding every page's cells in
-- raw_json. report_pages is untouched: it remains available for storing
-- rasterised page images for a provider with no native PDF support.

alter table extractions alter column page_no drop not null;

do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'extractions'::regclass
    and contype = 'u'
    and conkey = (
      select array_agg(attnum order by attnum)
      from pg_attribute
      where attrelid = 'extractions'::regclass
        and attname in ('report_id', 'page_no')
    );

  if v_constraint is not null then
    execute format('alter table extractions drop constraint %I', v_constraint);
  end if;
end $$;

alter table extractions add constraint extractions_report_id_key unique (report_id);
