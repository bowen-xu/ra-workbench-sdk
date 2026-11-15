//! Mechanical assembly of the original literal-substring catalog search plan.
//! Callers supply fixed reviewed SQL fragments. Terms remain bound parameters.
pub struct CatalogSearchSql<'a> {
    pub scan_body: &'a str,
    pub scan_metadata: &'a str,
    pub fts_body: &'a str,
    pub fts_metadata: &'a str,
    pub result: &'a str,
}

pub fn catalog_search_sql(fragments: CatalogSearchSql<'_>, scans: &[bool]) -> String {
    let mut hits = Vec::new();
    for (index, scan) in scans.iter().enumerate() {
        let parameter = index + 5;
        let raw = parameter + scans.len();
        let pair = if *scan {
            [fragments.scan_body, fragments.scan_metadata]
        } else {
            [fragments.fts_body, fragments.fts_metadata]
        };
        for template in pair {
            hits.push(
                template
                    .trim_end_matches('\n')
                    .replace("{{index}}", &index.to_string())
                    .replace("{{parameter}}", &parameter.to_string())
                    .replace("{{raw}}", &raw.to_string()),
            );
        }
    }
    fragments
        .result
        .trim_end_matches('\n')
        .replace("{{hits}}", &hits.join(" union all "))
        .replace("{{count}}", &scans.len().to_string())
}
