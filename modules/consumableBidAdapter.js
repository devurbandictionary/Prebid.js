import * as utils from 'src/utils';
import { registerBidder } from 'src/adapters/bidderFactory';
import { config } from 'src/config';
import { EVENTS } from 'src/constants.json';

const CONSUMABLE_BIDDERS_CODES = {
  CONSUMABLE: 'consumable'
};

const CONSUMABLE_ENDPOINTS = {
  DISPLAY: {
    GET: 'display-get'
  }
};

const SYNC_TYPES = {
  IFRAME: {
    TAG: 'iframe',
    TYPE: 'iframe'
  },
  IMAGE: {
    TAG: 'img',
    TYPE: 'image'
  }
};

const pubapiTemplate = template`//${'host'}/pubapi/3.0/${'network'}/${'placement'}/${'pageid'}/${'sizeid'}/ADTECH;v=2;cmd=bid;cors=yes;alias=${'alias'}${'bidfloor'}${'keyValues'};misc=${'misc'}`;
const MP_SERVER_MAP = {
  us: 'adserver-us.adtech.advertising.com',
  eu: 'adserver-eu.adtech.advertising.com',
  as: 'adserver-as.adtech.advertising.com'
};
const ONE_DISPLAY_TTL = 60;

$$PREBID_GLOBAL$$.consumableGlobals = {
  pixelsDropped: false
};

function isInteger(value) {
  return typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value;
}

function template(strings, ...keys) {
  return function(...values) {
    let dict = values[values.length - 1] || {};
    let result = [strings[0]];
    keys.forEach(function(key, i) {
      let value = isInteger(key) ? values[key] : dict[key];
      result.push(value, strings[i + 1]);
    });
    return result.join('');
  };
}

function isSecureProtocol() {
  return document.location.protocol === 'https:';
}

function parsePixelItems(pixels) {
  let itemsRegExp = /(img|iframe)[\s\S]*?src\s*=\s*("|')(.*?)\2/gi;
  let tagNameRegExp = /\w*(?=\s)/;
  let srcRegExp = /src=("|')(.*?)\1/;
  let pixelsItems = [];

  if (pixels) {
    let matchedItems = pixels.match(itemsRegExp);
    if (matchedItems) {
      matchedItems.forEach(item => {
        let tagName = item.match(tagNameRegExp)[0];
        let url = item.match(srcRegExp)[2];

        if (tagName && tagName) {
          pixelsItems.push({
            type: tagName === SYNC_TYPES.IMAGE.TAG ? SYNC_TYPES.IMAGE.TYPE : SYNC_TYPES.IFRAME.TYPE,
            url: url
          });
        }
      });
    }
  }

  return pixelsItems;
}

function _buildMarketplaceUrl(bid) {
  const params = bid.params;
  const serverParam = params.server;
  let regionParam = params.region || 'us';
  let server;

  if (!MP_SERVER_MAP.hasOwnProperty(regionParam)) {
    utils.logWarn(`Unknown region '${regionParam}' for Consumable bidder.`);
    regionParam = 'us'; // Default region.
  }

  if (serverParam) {
    server = serverParam;
  } else {
    server = MP_SERVER_MAP[regionParam];
  }

  // Set region param, used by Consumable analytics.
  params.region = regionParam;

  return pubapiTemplate({
    host: server,
    network: '10947.1',
    cid: params.cid,
    unit: params.unit,
    cadj: parseFloat(params.cadj),
    placement: parseInt(params.placement),
    pageid: params.pageId || 0,
    sizeid: params.sizeId || 0,
    alias: params.alias || utils.getUniqueIdentifierStr(),
    bidfloor: formatMarketplaceBidFloor(params.bidFloor),
    keyValues: formatMarketplaceKeyValues(params.keyValues),
    misc: new Date().getTime() // cache busting
  });
}

function formatMarketplaceBidFloor(bidFloor) {
  return (typeof bidFloor !== 'undefined') ? `;bidfloor=${bidFloor.toString()}` : '';
}

function formatMarketplaceKeyValues(keyValues) {
  let formattedKeyValues = '';

  utils._each(keyValues, (value, key) => {
    formattedKeyValues += `;kv${key}=${encodeURIComponent(value)}`;
  });

  return formattedKeyValues;
}

function _isMarketplaceBidder(bidder) {
  return bidder === CONSUMABLE_BIDDERS_CODES.CONSUMABLE
}

function isMarketplaceBid(bid) {
  var x = _isMarketplaceBidder(bid.bidder);
  return _isMarketplaceBidder(bid.bidder) && bid.params.placement;
}

function resolveEndpointCode(bid) {
  return CONSUMABLE_ENDPOINTS.DISPLAY.GET;
}

function formatBidRequest(endpointCode, bid) {
  let bidRequest;

  switch (endpointCode) {
    case CONSUMABLE_ENDPOINTS.DISPLAY.GET:
      bidRequest = {
        url: _buildMarketplaceUrl(bid),
        method: 'GET',
        ttl: ONE_DISPLAY_TTL
      };
      break;
  }

  bidRequest.bidderCode = bid.bidder;
  bidRequest.bidId = bid.bidId;
  bidRequest.userSyncOn = bid.params.userSyncOn;
  bidRequest.cid = bid.params.cid;
  bidRequest.unit = bid.params.unit
  bidRequest.cadj = bid.params.cadj

  return bidRequest;
}

export const spec = {
  code: CONSUMABLE_BIDDERS_CODES.CONSUMABLE,
  isBidRequestValid: function(bid) {
    return isMarketplaceBid(bid)
  },
  buildRequests: function (bids) {
    return bids.map(bid => {
      const endpointCode = resolveEndpointCode(bid);

      if (endpointCode) {
        return formatBidRequest(endpointCode, bid);
      }
    });
  },
  interpretResponse: function ({body}, bidRequest) {
    if (!body) {
      utils.logError('Empty bid response', bidRequest.bidderCode, body);
    } else {
      let bid = this._parseBidResponse(body, bidRequest);
      if (bid) {
        return bid;
      }
    }
  },
  _formatPixels: function (pixels) {
    let formattedPixels = pixels.replace(/<\/?script( type=('|")text\/javascript('|")|)?>/g, '');

    return '<script>var w=window,prebid;' +
      'for(var i=0;i<10;i++){w = w.parent;prebid=w.$$PREBID_GLOBAL$$;' +
      'if(prebid && prebid.consumableGlobals && !prebid.consumableGlobals.pixelsDropped){' +
      'try{prebid.consumableGlobals.pixelsDropped=true;' + formattedPixels + 'break;}' +
      'catch(e){continue;}' +
      '}}</script>';
  },
  _parseBidResponse: function (response, bidRequest) {
    let bidData;
    try {
      bidData = response.seatbid[0].bid[0];
    } catch (e) {
      return;
    }

    let cpm;

    if (bidData.ext && bidData.ext.encp) {
      cpm = bidData.ext.encp;
    } else {
      cpm = bidData.price;

      if (cpm === null || isNaN(cpm)) {
        utils.logError('Invalid price in bid response', CONSUMABLE_BIDDERS_CODES.CONSUMABLE, bid);
        return;
      }
    }
    cpm = cpm * parseFloat(bidRequest.cadj);

    let oad = bidData.adm;
    let ad;
    ad = "<script type='text/javascript'>document.write('<div id=\""+bidRequest.unit+"-"+bidRequest.cid+"\">');</script>" + oad;
    ad += "<script type='text/javascript'>document.write('</div>');</script>";
    ad += "<script type='text/javascript'>document.write('<div class=\""+bidRequest.unit+"\"></div>');</script>";
    ad += "<script type='text/javascript'>document.write('<scr'+'ipt type=\"text/javascript\" src=\"https://yummy.consumable.com/"+bidRequest.cid+"/"+bidRequest.unit+"/widget/unit.js\" charset=\"utf-8\" async></scr' + 'ipt>');</script>"
    if (response.ext && response.ext.pixels) {
      if (config.getConfig('consumable.userSyncOn') !== EVENTS.BID_RESPONSE) {
        ad += this._formatPixels(response.ext.pixels);
      }
    }

    return {
      bidderCode: bidRequest.bidderCode,
      requestId: bidRequest.bidId,
      ad: ad,
      cpm: cpm,
      width: bidData.w,
      height: bidData.h,
      creativeId: bidData.crid,
      pubapiId: response.id,
      currency: response.cur,
      dealId: bidData.dealid,
      netRevenue: true,
      ttl: bidRequest.ttl
    };
  },
  getUserSyncs: function(options, bidResponses) {
    let bidResponse = bidResponses[0];

    if (config.getConfig('consumable.userSyncOn') === EVENTS.BID_RESPONSE) {
      if (!$$PREBID_GLOBAL$$.consumableGlobals.pixelsDropped && bidResponse.ext && bidResponse.ext.pixels) {
        $$PREBID_GLOBAL$$.consumableGlobals.pixelsDropped = true;

        return parsePixelItems(bidResponse.ext.pixels);
      }
    }

    return [];
  }
};

registerBidder(spec);
