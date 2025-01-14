import {
  get,
  isEmpty,
} from 'lodash';

import { makeQueryFunction } from '@folio/stripes/smart-components';
import {
  CQL_FIND_ALL,
  browseModeOptions,
  browseModeMap,
  undefinedAsString,
  queryIndexes
} from '../constants';
import {
  getQueryTemplate,
  getIsbnIssnTemplate,
} from '../utils';
import { getFilterConfig } from '../filterConfig';
import facetsStore from '../stores/facetsStore';

const INITIAL_RESULT_COUNT = 100;
const regExp = /^((callNumber|subject|name|itemEffectiveShelvingOrder) [<|>])/i;
const DEFAULT_SORT = 'title';

const getQueryTemplateValue = (queryValue, param) => {
  return regExp.test(queryValue)
    ? queryValue
    : `${param}>="${queryValue.replace(/"/g, '')}" or ${param}<"${queryValue.replace(/"/g, '')}"`;
};

const getQueryTemplateContributor = (queryValue) => `contributors.name ==/string "${queryValue}"`;
const getQueryTemplateSubjects = (queryValue) => `subjects==/string "${queryValue.replace(/"/g, '')}"`;
const getQueryTemplateCallNumber = (queryValue) => `itemEffectiveShelvingOrder==/string "${queryValue}"`;

const getParamValue = (queryParams, browseValue, noBrowseValue) => {
  const query = get(queryParams, 'query', '');

  if (Object.values(browseModeOptions).includes(queryParams.qindex) || regExp.test(query)) {
    return browseValue;
  }

  return noBrowseValue;
};

export function buildQuery(queryParams, pathComponents, resourceData, logger, props) {
  const { indexes, sortMap, filters } = getFilterConfig(queryParams.segment);
  const query = { ...resourceData.query };
  const queryIndex = queryParams?.qindex ?? 'all';
  const queryValue = get(queryParams, 'query', '');
  const browsePoint = queryParams?.browsePoint;
  let queryTemplate = getQueryTemplate(queryIndex, indexes);

  if (queryIndex.match(/isbn|issn/)) {
    // eslint-disable-next-line camelcase
    const identifierTypes = resourceData?.identifier_types?.records ?? [];
    queryTemplate = getIsbnIssnTemplate(queryTemplate, identifierTypes, queryIndex);
  }

  let templateQueryValue = browsePoint || queryValue;

  if (Object.values(browseModeOptions).includes(queryIndex)
  && !query.query
  && query.filters) {
    query.query = undefinedAsString;
    templateQueryValue = undefinedAsString;
  }

  if (queryIndex === browseModeOptions.CALL_NUMBERS) {
    queryTemplate = getQueryTemplateValue(templateQueryValue, 'callNumber');
  }

  if (queryIndex === browseModeOptions.SUBJECTS) {
    queryTemplate = getQueryTemplateValue(templateQueryValue, 'subject');
  }

  if (queryIndex === browseModeOptions.CONTRIBUTORS) {
    queryTemplate = getQueryTemplateValue(templateQueryValue, 'name');
  }

  if (queryIndex === queryIndexes.SUBJECT) {
    queryTemplate = getQueryTemplateSubjects(queryValue);
  }

  if (queryIndex === queryIndexes.CALL_NUMBER) {
    queryTemplate = getQueryTemplateCallNumber(queryValue);
  }

  if (queryIndex === queryIndexes.CONTRIBUTOR && queryParams?.selectedBrowseResult === 'true') {
    queryTemplate = getQueryTemplateContributor(queryValue);
    query.selectedBrowseResult = false; // reset this parameter so the next search uses `=` instead of `==/string`
  }

  if (queryIndex === queryIndexes.QUERY_SEARCH && queryValue.match('sortby')) {
    query.sort = '';
  } else if (!query.sort) {
    // Default sort for filtering/searching instances/holdings/items should be by title (UIIN-1046)
    query.sort = DEFAULT_SORT;
  }

  if (Object.values(browseModeOptions).includes(queryIndex)) {
    query.sort = '';
  }

  resourceData.query = { ...query, qindex: '' };

  // makeQueryFunction escapes quote and backslash characters by default,
  // but when submitting a raw CQL query (i.e. when queryIndex === 'querySearch')
  // we assume the user knows what they are doing and wants to run the CQL as-is.
  return makeQueryFunction(
    CQL_FIND_ALL,
    queryTemplate,
    sortMap,
    filters,
    2,
    null,
    queryIndex !== 'querySearch',
  )(queryParams, pathComponents, resourceData, logger, props);
}

const memoizeGetFetch = (fn) => {
  let prevLocationKey = '';
  let prevResultOffset = '';
  let prevResult = false;

  return props => {
    const {
      location,
      resources: {
        resultOffset,
      },
    } = props;

    if (
      prevLocationKey === location.key &&
      prevResultOffset === resultOffset
    ) {
      return prevResult;
    } else {
      const result = fn(props);
      prevLocationKey = location.key;
      prevResultOffset = resultOffset;
      prevResult = result;
      return result;
    }
  };
};

const getFetchProp = () => {
  let prevQindex = null;
  let prevQuery = null;

  return memoizeGetFetch(props => {
    const {
      location,
    } = props;
    const params = new URLSearchParams(location.search);
    const qindex = params.get('qindex');
    const query = params.get('query');
    const browsePoint = params.get('browsePoint');
    const filters = params.get('filters');
    const sort = params.get('sort');
    const selectedBrowseResult = params.get('selectedBrowseResult');
    const hasReset = (
      !qindex &&
      !query &&
      !filters &&
      (sort === DEFAULT_SORT || !sort) &&
      isEmpty(facetsStore.getState().facetSettings) &&
      !browsePoint
    );
    let isFetch = true;

    if (prevQindex !== qindex) {
      isFetch = (
        hasReset ||
        prevQuery !== query ||
        selectedBrowseResult === 'true'
      );
    }

    prevQindex = qindex;
    prevQuery = query;
    return isFetch;
  });
};

const buildRecordsManifest = (options = {}) => {
  const { path } = options;

  return {
    type: 'okapi',
    records:  (queryParams) => getParamValue(queryParams, 'items', 'instances'),
    resultOffset: '%{resultOffset}',
    perRequest: 100,
    throwErrors: false,
    path: 'inventory/instances',
    resultDensity: 'sparse',
    accumulate: 'true',
    fetch: getFetchProp(),
    GET: {
      path,
      params: {
        query: buildQuery,
        highlightMatch: (queryParams) => {
          const queryValue = get(queryParams, 'query', '');

          return !!queryValue && !regExp.test(queryValue);
        },
        precedingRecordsCount: (queryParams) => getParamValue(queryParams, 5),
      },
    },
  };
};

export function buildManifestObject() {
  return {
    numFiltersLoaded: { initialValue: 1 }, // will be incremented as each filter loads
    query: {
      initialValue: {
        query: '',
        browsePoint: '',
        filters: '',
        sort: '',
        selectedBrowseResult: false,
      },
    },
    resultCount: { initialValue: INITIAL_RESULT_COUNT },
    resultOffset: { initialValue: 0 },
    records: buildRecordsManifest({
      path: (queryParams) => (!browseModeMap[queryParams.qindex] ? 'search/instances' : null),
    }),
    browseModeRecords: buildRecordsManifest({
      path: (queryParams) => {
        if (queryParams.qindex === browseModeOptions.SUBJECTS) {
          return 'browse/subjects/instances';
        } else if (queryParams.qindex === browseModeOptions.CALL_NUMBERS) {
          return 'browse/call-numbers/instances';
        } else if (queryParams.qindex === browseModeOptions.CONTRIBUTORS) {
          return 'browse/contributors/instances';
        }
        return null;
      },
    }),
    recordsToExportIDs: {
      type: 'okapi',
      records: 'ids',
      accumulate: true,
      fetch: false,
      path: 'search/instances/ids',
      throwErrors: false,
      GET: {
        params: {
          query: buildQuery,
        },
        staticFallback: { params: {} },
      },
    },
    holdingsToExportIDs: {
      type: 'okapi',
      records: 'ids',
      accumulate: true,
      fetch: false,
      path: 'search/holdings/ids',
      throwErrors: false,
      GET: {
        params: {
          query: buildQuery,
        },
        staticFallback: { params: {} },
      },
    },
    quickExport: {
      type: 'okapi',
      fetch: false,
      path: 'data-export/quick-export',
      throwErrors: false,
      clientGeneratePk: false,
    },
    itemsInTransitReport: {
      type: 'okapi',
      records: 'items',
      path: 'inventory-reports/items-in-transit',
      accumulate: true,
      fetch: false,
    },
  };
}
