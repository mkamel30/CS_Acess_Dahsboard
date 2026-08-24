/**
 * API ENGINE: Unified RESTful Dynamic Querying & Envelope Architecture
 * Handles View Modes (summary / compact / full), Sparse Fieldsets (projection),
 * Standard Pagination Metadata, and Performance Optimizations.
 */

function parseDynamicQuery(reqQuery = {}) {
    const rawView = String(reqQuery.view || '').trim().toLowerCase();
    const view = ['summary', 'compact', 'full'].includes(rawView) ? rawView : 'full';

    const rawFields = String(reqQuery.fields || '').trim();
    const fields = rawFields ? rawFields.split(',').map(f => f.trim()).filter(Boolean) : null;

    const page = Math.max(1, parseInt(reqQuery.page, 10) || 1);
    const defaultLimit = view === 'compact' ? 20 : 50;
    const limit = reqQuery.limit === 'all' ? 999999 : Math.max(1, parseInt(reqQuery.limit, 10) || defaultLimit);
    const offset = parseInt(reqQuery.offset, 10) || ((page - 1) * limit);

    const search = String(reqQuery.search || '').trim();
    const sortBy = String(reqQuery.sort_by || reqQuery.sortBy || '').trim();
    const sortOrder = String(reqQuery.sort_order || reqQuery.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const dateFrom = String(reqQuery.date_from || reqQuery.start_date || '').trim();
    const dateTo = String(reqQuery.date_to || reqQuery.end_date || '').trim();

    return {
        view,
        fields,
        page,
        limit,
        offset,
        search,
        sortBy,
        sortOrder,
        dateFrom,
        dateTo
    };
}

function projectFields(items = [], requestedFields = null, viewMode = 'full', defaultCompactFields = []) {
    if (!Array.isArray(items)) return items;
    if (viewMode === 'summary') return [];

    let targetFields = requestedFields;
    if (!targetFields && viewMode === 'compact' && defaultCompactFields.length > 0) {
        targetFields = defaultCompactFields;
    }

    if (!targetFields || targetFields.length === 0) {
        return items;
    }

    const fieldSet = new Set(targetFields);
    return items.map(item => {
        if (!item || typeof item !== 'object') return item;
        const projected = {};
        for (const key of fieldSet) {
            if (key in item) {
                projected[key] = item[key];
            }
        }
        return projected;
    });
}

function buildEnvelope({
    success = true,
    data = null,
    summary = null,
    total = 0,
    page = 1,
    limit = 50,
    view = 'full',
    extraMeta = {},
    legacyKeys = {}
}) {
    const totalRecords = total !== undefined && total !== null ? total : (Array.isArray(data) ? data.length : 0);
    const pageSize = limit || 50;
    const totalPages = pageSize >= 999999 ? 1 : Math.max(1, Math.ceil(totalRecords / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);

    const nowCairo = new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' });

    const envelope = {
        success,
        meta: {
            total_records: totalRecords,
            page: currentPage,
            page_size: pageSize,
            total_pages: totalPages,
            has_next: currentPage < totalPages,
            has_prev: currentPage > 1,
            view_mode: view,
            timestamp_cairo: nowCairo,
            ...extraMeta
        }
    };

    if (summary !== null && summary !== undefined) {
        envelope.summary = summary;
    }

    if (view !== 'summary' && data !== null && data !== undefined) {
        envelope.data = data;
    }

    // Attach backwards-compatible legacy keys (e.g. movements, devices, sims, contracts)
    // so existing frontend functions continue working seamlessly without any breaking changes
    if (legacyKeys && typeof legacyKeys === 'object') {
        Object.assign(envelope, legacyKeys);
    }

    return envelope;
}

module.exports = {
    parseDynamicQuery,
    projectFields,
    buildEnvelope
};
