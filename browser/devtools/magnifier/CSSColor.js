/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


/*
  CssColor class
  The class accepts a color value in any unit.
  The color gets converted to an rgb (and stored in rgb property) and
  to an rgba (and stores in rgba property).
  These 2 properties serve as intermediates for conversions to other properties.;
;

  The rgb property will have lost the alpha value if the color has a alpha
  channel. However, toUnit will not allow such a coversion.

  The method toUnit, converts the color in the object to any of the supported
  units.
  To prevent loss of information, colors in units that have an alpha channel
  can't be converted to those that don't.
  So, everytime a conversion is asked for, it checks the alpha property
  is set. If alpha is true, the conversions are restricted to hsla and rgba.
;

  Once an instance is created with a color value, the color in any allowed unit
  maybe retrieved from it. using getters : hex, shortHex, rgb, rgba, nickname,
  hsl, hsla.

  The REGEX property contains regular expressions that can used to validate
  a color against a unit.
*/

function CssColor(aColorValue)
{
  if(typeof aColorValue !== "string") {
    this.unit = CssColor.COLORUNIT.invalid;
    return;
  }
  aColorValue = aColorValue.replace(/\s+/g, ""); //remove whitespaces
  let aRgbColor, aRgbaColor;
  if (this._isHexColor(aColorValue)) {
    aRgbColor = this._hexToRgb(aColorValue);
  } else if (this._isHslColor(aColorValue)) {
    aRgbColor = this._hslToRgb(aColorValue);
  } else if (this._isNickname(aColorValue)) {
    aRgbColor = this._nicknameToRgb(aColorValue);
  } else if(this._isRgbColor(aColorValue)) {
    aRgbColor = aColorValue.replace(/,/g, ", ");
  } else if(this._isHslaColor(aColorValue)) {
    aRgbaColor = this._hslaToRgba(aColorValue);
  } else if(this._isRgbaColor(aColorValue)) {
    aRgbaColor = aColorValue.replace(/,/g, ", ");
  }

  if(aRgbColor !== undefined) {
    this.rgb = this.currentColor = aRgbColor;
    this.rgba = this._rgbToRgba(this.rgb);
    this.unit = aRgbColor === "transparent" ? CssColor.COLORUNIT.nickname : CssColor.COLORUNIT.rgb;
    this.transparent = aColorValue === "transparent";
  } else if(aRgbaColor !== undefined) {
    this.rgba = this.currentColor = aRgbaColor;
    this.rgb = this.rgba.replace("rgba", "rgb").replace(/(,\s*(0(.\d+){0,1})|1)\)/, ")"); //alpha value lost
    this.alpha = true;
    this.unit = aRgbaColor === "transparent" ? CssColor.COLORUNIT.nickname : CssColor.COLORUNIT.rgba;
    this.transparent = aColorValue === "transparent";
  } else {
    //The entered string wasn't a color at all
    this.unit = CssColor.COLORUNIT.invalid;
  }
}

exports.CssColor = CssColor;

//The different color units that are supported.
CssColor.COLORUNIT = {
  "hex": 0,
  "shortHex": 1,
  "nickname": 2,
  "rgb": 3,
  "rgba": 4,
  "hsl": 5,
  "hsla": 6,
  "invalid": 7 //when a non-color value is passed
};

//A list of RegExes for color validation
CssColor.REGEX = {
  longHex: /#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/,
  shortHex: /#([0-9A-Fa-f]{1})([0-9A-Fa-f]{1})([0-9A-Fa-f]{1})/,
  hsl: /hsl\(\d+(\.\d+)?\s*,\s*((100(\.0*)?)|(\d{1,2}(\.\d+)?))%\s*,\s*((100(\.0*)?)|(\d{1,2}(\.\d+)?))%\)/,
  hsla: /hsla\(\s*\d+(\.\d+)?\s*,\s*((100(\.0*)?)|(\d{1,2}(\.\d+)?))%\s*,\s*((100(\.0*)?)|(\d{1,2}(\.\d+)?))%\s*,\s*((1(\.0+)?)|(0((\.\d+)?)))\)/,
  rgb: /rgb\(\s*((\d\d?)|([0,1]\d\d)|(2[0-4][0-9])|(25[0-5]))\s*,\s*((\d\d?)|([0,1]\d\d)|(2[0-4][0-9])|(25[0-5]))\s*,\s*((\d\d?)|([0,1]\d\d)|(2[0-4][0-9])|(25[0-5]))\s*\)/,
  rgba: /rgba\(\s*((\d\d?)|([0,1]\d\d)|(2[0-4][0-9])|(25[0-5]))\s*,\s*((\d\d?)|([0,1]\d\d)|(2[0-4][0-9])|(25[0-5]))\s*,\s*((\d\d?)|([0,1]\d\d)|(2[0-4][0-9])|(25[0-5]))\s*,\s*((1(\.0+)?)|(0((\.\d+)?)))\s*\)/,
  transparent: /transparent/
};

CssColor.prototype = {
  currentColor: null,

  rgb: null,

  rgba: null,

  unit: null,

  transparent: false,

  //if the color has an alpha component
  alpha: false,

  get hex()
  {
    if (this.transparent) {
      return "transparent";
    }
    return this.rgb.replace(/\brgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)/gi, function(_, r, g, b) {
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + (b << 0)).toString(16).substr(-6).toUpperCase();
    });
  },

  get shortHex()
  {
    if (this.transparent) {
      return "transparent";
    }
    if (this.hex.charAt(1) == this.hex.charAt(2) &&
        this.hex.charAt(3) == this.hex.charAt(4) &&
        this.hex.charAt(5) == this.hex.charAt(6)) {
      return "#" + this.hex.charAt(1) + this.hex.charAt(3) + this.hex.charAt(5);
    } else {
      return this.hex;
    }
  },

  get hsl()
  {
    if (this.transparent) {
      return "transparent";
    }
    let [r, g, b] = this._components;
    r /= 255, g /= 255, b /= 255;
    let max = Math.max(r, g, b);
    let min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if(max == min){
      h = s = 0;
    } else {
      let d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch(max) {
          case r:
            h = ((g - b) / d) % 6;
            break;
          case g:
            h = (b - r) / d + 2;
            break;
          case b:
            h = (r - g) / d + 4;
            break;
      }
      h *= 60;
      if (h < 0) {
        h += 360;
      }
    }
    return "hsl(" + (Math.round(h * 1000))/1000 + ", " + Math.round(s * 100) + "%, " + Math.round(l * 100) + "%)";
  },

  get hsla()
  {
    if (this.transparent) {
      return "hsla(0, 0%, 0%, 0)";
    }
    if(this.alpha === false) {
      return this.hsl.replace("hsl", "hsla").replace(")", ", 1)");
    }
    else {
      let hsl = this.hsl;
      let [r, g, b, a] = this._components;
      return hsl.replace("hsl", "hsla").replace(")", ", " + a + ")");
    }
  },

  get _components()
  {
    if (this.transparent) {
      return null;
    }
    let matches;
    if(this.alpha === false) {
      //Use the rgb
      matches = /\brgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)/gi.exec(this.rgb);
      return [matches[1], matches[2], matches[3]];
    } else {
      //Use the rgba
      matches = /\brgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*((0(.\d+){0,1})|1)\)/gi.exec(this.rgba);
      return [matches[1], matches[2], matches[3], matches[4]];
    }
  },

  get nickname()
  {
    if(this.alpha === true) {
      //There is no table that maps rgba values and nicknames
      return "not found";
    }
    return CssColor.rgbToNickname[this.rgb] || this.rgb;
  },

  _isRgbColor: function(aColor)
  {
    return CssColor.REGEX.rgb.test(aColor);
  },

  _isRgbaColor: function(aColor)
  {
    return CssColor.REGEX.rgba.test(aColor);
  },

  _isHexColor: function(aColor)
  {
    return CssColor.REGEX.longHex.test(aColor) || CssColor.REGEX.shortHex.test(aColor);
  },

  _rgbToRgba: function(aRgbColor)
  {
    let rgba = aRgbColor.replace("rgb", "rgba").replace(")", ", 1)");
    return rgba;
  },

  _hexToRgb: function(aHexColor)
  {
    let matches = aHexColor.match(CssColor.REGEX.longHex);
    let shortCol = false;
    let r, g, b;

    if (!matches) {
      matches = aHexColor.match(CssColor.REGEX.shortHex);
      shortCol = true;
    }
    if (matches) {
      if (shortCol) {
        r = parseInt(matches[1] + matches[1], 16);
        g = parseInt(matches[2] + matches[2], 16);
        b = parseInt(matches[3] + matches[3], 16);
      } else {
        r = parseInt(matches[1], 16);
        g = parseInt(matches[2], 16);
        b = parseInt(matches[3], 16);
      }
      return "rgb(" + r + ", " + g + ", " + b + ")";
    }
    return "";
  },

  _isHslColor: function(aColor)
  {
    return CssColor.REGEX.hsl.test(aColor);
  },

  _isHslaColor: function(aColor)
  {
    return CssColor.REGEX.hsla.test(aColor);
  },

  _hslToRgb: function(aHslColor)
  {
    let matches = aHslColor.match(/hsl\(\s*(\d+|(?:\d+.\d+))\s*,\s*(\d+|(?:\d+.\d+))%\s*,\s*(\d+|(?:\d+.\d+))%\s*\)/);

    if (matches) {
      let h = parseInt(matches[1]);
      let s = parseInt(matches[2]) / 100;
      let l = parseInt(matches[3]) / 100;
      let c = (1 - Math.abs(2 * l - 1)) * s;
      let h2 = h/60;
      let x = c * (1 - (h2 % 2 - 1));
      let r1, g1, b1;
      if(h2 >= 0 && h2 < 1) {
        [r1, g1, b1] = [c, x, 0];
      } else if(h2 >= 1 && h2 < 2) {
        [r1, g1, b1] = [x, c, 0];
      } else if(h2 >= 2 && h2 < 3) {
        [r1, g1, b1] = [0, c, x];
      } else if(h2 >= 3 && h2 < 4) {
        [r1, g1, b1] = [0, x, c];
      } else if(h2 >= 4 && h2 < 5) {
        [r1, g1, b1] = [x, 0, c];
      } else if(h2 >= 5 && h2 < 6) {
        [r1, g1, b1] = [c, 0, x];
      }
      let m = l - 0.5 * c;
      let rgb = [r1, g1, b1];
      rgb.forEach(function(el, index, arr) {
        arr[index] += m;
        arr[index] *= 255;
        arr[index] = parseInt(arr[index]);
      })
      let [r, g, b] = rgb;
      return "rgb(" + r + ", " + g + ", " + b + ")";
    }
    return "";
  },

  _hslaToRgba: function(aHslaColor)
  {
    let matches = aHslaColor.match(/,([^,]*)\)/);
    let alpha = matches[1];
    let hsl = aHslaColor.replace(/,([^,]*)\)/, ")").replace("hsla", "hsl");
    let rgb = this._hslToRgb(hsl);
    let rgba = rgb.replace(")", ", " + alpha + ")").replace("rgb", "rgba");
    return rgba;
  },

  _isNickname: function(aColor)
  {
    return aColor in CssColor.nicknameToRgb;
  },

  _nicknameToRgb: function(aRgbColor)
  {
    return CssColor.nicknameToRgb[aRgbColor];
  },

  /*Converts the color present in this.rgb or this.rgba (depending on
  this.alpha) to the required color unit.*/
  toUnit: function(aColorUnit) {
    let color;
    if(this.alpha === true) {
      //Only rgba and hsla alowed
      switch(aColorUnit) {
        case CssColor.COLORUNIT.rgba:
          color = this.rgba;
          break;
        case CssColor.COLORUNIT.hsla: case CssColor.COLORUNIT.hsl:
          color = this.hsla;
          break;
        default:
          color = this.rgba;
      }
    }
    else {
      switch(aColorUnit) {
        case CssColor.COLORUNIT.nickname:
          color = this.nickname;
          break;
        case CssColor.COLORUNIT.hex:
          color = this.hex;
          break;
        case CssColor.COLORUNIT.shortHex:
          color = this.shortHex;
          break;
        case CssColor.COLORUNIT.rgb:
          color = this.rgb;
          break;
        case CssColor.COLORUNIT.rgba:
          color = this.rgba;
          break;
        case CssColor.COLORUNIT.hsl:
          color = this.hsl;
          break;
        case CssColor.COLORUNIT.hsla:
          color = this.hsla;
          break;
        default:
          color = this.rgb;
      }
    }
    return color;
  }
};

CssColor.rgbToNickname = {
  "transparent": "transparent",
  "rgb(0, 0, 0)": "black",
  "rgb(0, 0, 128)": "navy",
  "rgb(0, 0, 139)": "darkblue",
  "rgb(0, 0, 205)": "mediumblue",
  "rgb(0, 0, 255)": "blue",
  "rgb(0, 100, 0)": "darkgreen",
  "rgb(0, 128, 0)": "green",
  "rgb(0, 128, 128)": "teal",
  "rgb(0, 139, 139)": "darkcyan",
  "rgb(0, 191, 255)": "deepskyblue",
  "rgb(0, 206, 209)": "darkturquoise",
  "rgb(0, 250, 154)": "mediumspringgreen",
  "rgb(0, 255, 0)": "lime",
  "rgb(0, 255, 127)": "springgreen",
  "rgb(0, 255, 255)": "aqua",
  "rgb(0, 255, 255)": "cyan",
  "rgb(100, 149, 237)": "cornflowerblue",
  "rgb(102, 205, 170)": "mediumaquamarine",
  "rgb(105, 105, 105)": "dimgray",
  "rgb(105, 105, 105)": "dimgrey",
  "rgb(106, 90, 205)": "slateblue",
  "rgb(107, 142, 35)": "olivedrab",
  "rgb(112, 128, 144)": "slategray",
  "rgb(112, 128, 144)": "slategrey",
  "rgb(119, 136, 153)": "lightslategray",
  "rgb(119, 136, 153)": "lightslategrey",
  "rgb(123, 104, 238)": "mediumslateblue",
  "rgb(124, 252, 0)": "lawngreen",
  "rgb(127, 255, 0)": "chartreuse",
  "rgb(127, 255, 212)": "aquamarine",
  "rgb(128, 0, 0)": "maroon",
  "rgb(128, 0, 128)": "purple",
  "rgb(128, 128, 0)": "olive",
  "rgb(128, 128, 128)": "gray",
  "rgb(128, 128, 128)": "grey",
  "rgb(135, 206, 235)": "skyblue",
  "rgb(135, 206, 250)": "lightskyblue",
  "rgb(138, 43, 226)": "blueviolet",
  "rgb(139, 0, 0)": "darkred",
  "rgb(139, 0, 139)": "darkmagenta",
  "rgb(139, 69, 19)": "saddlebrown",
  "rgb(143, 188, 143)": "darkseagreen",
  "rgb(144, 238, 144)": "lightgreen",
  "rgb(147, 112, 219)": "mediumpurple",
  "rgb(148, 0, 211)": "darkviolet",
  "rgb(152, 251, 152)": "palegreen",
  "rgb(153, 50, 204)": "darkorchid",
  "rgb(154, 205, 50)": "yellowgreen",
  "rgb(160, 82, 45)": "sienna",
  "rgb(165, 42, 42)": "brown",
  "rgb(169, 169, 169)": "darkgray",
  "rgb(169, 169, 169)": "darkgrey",
  "rgb(173, 216, 230)": "lightblue",
  "rgb(173, 255, 47)": "greenyellow",
  "rgb(175, 238, 238)": "paleturquoise",
  "rgb(176, 196, 222)": "lightsteelblue",
  "rgb(176, 224, 230)": "powderblue",
  "rgb(178, 34, 34)": "firebrick",
  "rgb(184, 134, 11)": "darkgoldenrod",
  "rgb(186, 85, 211)": "mediumorchid",
  "rgb(188, 143, 143)": "rosybrown",
  "rgb(189, 183, 107)": "darkkhaki",
  "rgb(192, 192, 192)": "silver",
  "rgb(199, 21, 133)": "mediumvioletred",
  "rgb(205, 133, 63)": "peru",
  "rgb(205, 92, 92)": "indianred",
  "rgb(210, 105, 30)": "chocolate",
  "rgb(210, 180, 140)": "tan",
  "rgb(211, 211, 211)": "lightgray",
  "rgb(211, 211, 211)": "lightgrey",
  "rgb(216, 191, 216)": "thistle",
  "rgb(218, 112, 214)": "orchid",
  "rgb(218, 165, 32)": "goldenrod",
  "rgb(219, 112, 147)": "palevioletred",
  "rgb(220, 20, 60)": "crimson",
  "rgb(220, 220, 220)": "gainsboro",
  "rgb(221, 160, 221)": "plum",
  "rgb(222, 184, 135)": "burlywood",
  "rgb(224, 255, 255)": "lightcyan",
  "rgb(230, 230, 250)": "lavender",
  "rgb(233, 150, 122)": "darksalmon",
  "rgb(238, 130, 238)": "violet",
  "rgb(238, 232, 170)": "palegoldenrod",
  "rgb(240, 128, 128)": "lightcoral",
  "rgb(240, 230, 140)": "khaki",
  "rgb(240, 248, 255)": "aliceblue",
  "rgb(240, 255, 240)": "honeydew",
  "rgb(240, 255, 255)": "azure",
  "rgb(244, 164, 96)": "sandybrown",
  "rgb(245, 222, 179)": "wheat",
  "rgb(245, 245, 220)": "beige",
  "rgb(245, 245, 245)": "whitesmoke",
  "rgb(245, 255, 250)": "mintcream",
  "rgb(248, 248, 255)": "ghostwhite",
  "rgb(25, 25, 112)": "midnightblue",
  "rgb(250, 128, 114)": "salmon",
  "rgb(250, 235, 215)": "antiquewhite",
  "rgb(250, 240, 230)": "linen",
  "rgb(250, 250, 210)": "lightgoldenrodyellow",
  "rgb(253, 245, 230)": "oldlace",
  "rgb(255, 0, 0)": "red",
  "rgb(255, 0, 255)": "fuchsia",
  "rgb(255, 0, 255)": "magenta",
  "rgb(255, 105, 180)": "hotpink",
  "rgb(255, 127, 80)": "coral",
  "rgb(255, 140, 0)": "darkorange",
  "rgb(255, 160, 122)": "lightsalmon",
  "rgb(255, 165, 0)": "orange",
  "rgb(255, 182, 193)": "lightpink",
  "rgb(255, 192, 203)": "pink",
  "rgb(255, 20, 147)": "deeppink",
  "rgb(255, 215, 0)": "gold",
  "rgb(255, 218, 185)": "peachpuff",
  "rgb(255, 222, 173)": "navajowhite",
  "rgb(255, 228, 181)": "moccasin",
  "rgb(255, 228, 196)": "bisque",
  "rgb(255, 228, 225)": "mistyrose",
  "rgb(255, 235, 205)": "blanchedalmond",
  "rgb(255, 239, 213)": "papayawhip",
  "rgb(255, 240, 245)": "lavenderblush",
  "rgb(255, 245, 238)": "seashell",
  "rgb(255, 248, 220)": "cornsilk",
  "rgb(255, 250, 205)": "lemonchiffon",
  "rgb(255, 250, 240)": "floralwhite",
  "rgb(255, 250, 250)": "snow",
  "rgb(255, 255, 0)": "yellow",
  "rgb(255, 255, 224)": "lightyellow",
  "rgb(255, 255, 240)": "ivory",
  "rgb(255, 255, 255)": "white",
  "rgb(255, 69, 0)": "orangered",
  "rgb(255, 99, 71)": "tomato",
  "rgb(30, 144, 255)": "dodgerblue",
  "rgb(32, 178, 170)": "lightseagreen",
  "rgb(34, 139, 34)": "forestgreen",
  "rgb(46, 139, 87)": "seagreen",
  "rgb(47, 79, 79)": "darkslategray",
  "rgb(47, 79, 79)": "darkslategrey",
  "rgb(50, 205, 50)": "limegreen",
  "rgb(60, 179, 113)": "mediumseagreen",
  "rgb(64, 224, 208)": "turquoise",
  "rgb(65, 105, 225)": "royalblue",
  "rgb(70, 130, 180)": "steelblue",
  "rgb(72, 209, 204)": "mediumturquoise",
  "rgb(72, 61, 139)": "darkslateblue",
  "rgb(75, 0, 130)": "indigo",
  "rgb(85, 107, 47)": "darkolivegreen",
  "rgb(95, 158, 160)": "cadetblue"
};

CssColor.nicknameToRgb = {
  "aliceblue": "rgb(240,248,255)",
  "antiquewhite": "rgb(250,235,215)",
  "aqua": "rgb(0,255,255)",
  "aquamarine": "rgb(127,255,212)",
  "azure": "rgb(240,255,255)",
  "beige": "rgb(245,245,220)",
  "bisque": "rgb(255,228,196)",
  "black": "rgb(0,0,0)",
  "blanchedalmond": "rgb(255,235,205)",
  "blue": "rgb(0,0,255)",
  "blueviolet": "rgb(138,43,226)",
  "brown": "rgb(165,42,42)",
  "burlywood": "rgb(222,184,135)",
  "cadetblue": "rgb(95,158,160)",
  "chartreuse": "rgb(127,255,0)",
  "chocolate": "rgb(210,105,30)",
  "coral": "rgb(255,127,80)",
  "cornflowerblue": "rgb(100,149,237)",
  "cornsilk": "rgb(255,248,220)",
  "crimson": "rgb(220,20,60)",
  "cyan": "rgb(0,255,255)",
  "darkblue": "rgb(0,0,139)",
  "darkcyan": "rgb(0,139,139)",
  "darkgoldenrod": "rgb(184,134,11)",
  "darkgray": "rgb(169,169,169)",
  "darkgreen": "rgb(0,100,0)",
  "darkgrey": "rgb(169,169,169)",
  "darkkhaki": "rgb(189,183,107)",
  "darkmagenta": "rgb(139,0,139)",
  "darkolivegreen": "rgb(85,107,47)",
  "darkorange": "rgb(255,140,0)",
  "darkorchid": "rgb(153,50,204)",
  "darkred": "rgb(139,0,0)",
  "darksalmon": "rgb(233,150,122)",
  "darkseagreen": "rgb(143,188,143)",
  "darkslateblue": "rgb(72,61,139)",
  "darkslategray": "rgb(47,79,79)",
  "darkslategrey": "rgb(47,79,79)",
  "darkturquoise": "rgb(0,206,209)",
  "darkviolet": "rgb(148,0,211)",
  "deeppink": "rgb(255,20,147)",
  "deepskyblue": "rgb(0,191,255)",
  "dimgray": "rgb(105,105,105)",
  "dimgrey": "rgb(105,105,105)",
  "dodgerblue": "rgb(30,144,255)",
  "firebrick": "rgb(178,34,34)",
  "floralwhite": "rgb(255,250,240)",
  "forestgreen": "rgb(34,139,34)",
  "fuchsia": "rgb(255,0,255)",
  "gainsboro": "rgb(220,220,220)",
  "ghostwhite": "rgb(248,248,255)",
  "gold": "rgb(255,215,0)",
  "goldenrod": "rgb(218,165,32)",
  "gray": "rgb(128,128,128)",
  "green": "rgb(0,128,0)",
  "greenyellow": "rgb(173,255,47)",
  "grey": "rgb(128,128,128)",
  "honeydew": "rgb(240,255,240)",
  "hotpink": "rgb(255,105,180)",
  "indianred": "rgb(205,92,92)",
  "indigo": "rgb(75,0,130)",
  "ivory": "rgb(255,255,240)",
  "khaki": "rgb(240,230,140)",
  "lavender": "rgb(230,230,250)",
  "lavenderblush": "rgb(255,240,245)",
  "lawngreen": "rgb(124,252,0)",
  "lemonchiffon": "rgb(255,250,205)",
  "lightblue": "rgb(173,216,230)",
  "lightcoral": "rgb(240,128,128)",
  "lightcyan": "rgb(224,255,255)",
  "lightgoldenrodyellow": "rgb(250,250,210)",
  "lightgray": "rgb(211,211,211)",
  "lightgreen": "rgb(144,238,144)",
  "lightgrey": "rgb(211,211,211)",
  "lightpink": "rgb(255,182,193)",
  "lightsalmon": "rgb(255,160,122)",
  "lightseagreen": "rgb(32,178,170)",
  "lightskyblue": "rgb(135,206,250)",
  "lightslategray": "rgb(119,136,153)",
  "lightslategrey": "rgb(119,136,153)",
  "lightsteelblue": "rgb(176,196,222)",
  "lightyellow": "rgb(255,255,224)",
  "lime": "rgb(0,255,0)",
  "limegreen": "rgb(50,205,50)",
  "linen": "rgb(250,240,230)",
  "magenta": "rgb(255,0,255)",
  "maroon": "rgb(128,0,0)",
  "mediumaquamarine": "rgb(102,205,170)",
  "mediumblue": "rgb(0,0,205)",
  "mediumorchid": "rgb(186,85,211)",
  "mediumpurple": "rgb(147,112,219)",
  "mediumseagreen": "rgb(60,179,113)",
  "mediumslateblue": "rgb(123,104,238)",
  "mediumspringgreen": "rgb(0,250,154)",
  "mediumturquoise": "rgb(72,209,204)",
  "mediumvioletred": "rgb(199,21,133)",
  "midnightblue": "rgb(25,25,112)",
  "mintcream": "rgb(245,255,250)",
  "mistyrose": "rgb(255,228,225)",
  "moccasin": "rgb(255,228,181)",
  "navajowhite": "rgb(255,222,173)",
  "navy": "rgb(0,0,128)",
  "oldlace": "rgb(253,245,230)",
  "olive": "rgb(128,128,0)",
  "olivedrab": "rgb(107,142,35)",
  "orange": "rgb(255,165,0)",
  "orangered": "rgb(255,69,0)",
  "orchid": "rgb(218,112,214)",
  "palegoldenrod": "rgb(238,232,170)",
  "palegreen": "rgb(152,251,152)",
  "paleturquoise": "rgb(175,238,238)",
  "palevioletred": "rgb(219,112,147)",
  "papayawhip": "rgb(255,239,213)",
  "peachpuff": "rgb(255,218,185)",
  "peru": "rgb(205,133,63)",
  "pink": "rgb(255,192,203)",
  "plum": "rgb(221,160,221)",
  "powderblue": "rgb(176,224,230)",
  "purple": "rgb(128,0,128)",
  "red": "rgb(255,0,0)",
  "rosybrown": "rgb(188,143,143)",
  "royalblue": "rgb(65,105,225)",
  "saddlebrown": "rgb(139,69,19)",
  "salmon": "rgb(250,128,114)",
  "sandybrown": "rgb(244,164,96)",
  "seagreen": "rgb(46,139,87)",
  "seashell": "rgb(255,245,238)",
  "sienna": "rgb(160,82,45)",
  "silver": "rgb(192,192,192)",
  "skyblue": "rgb(135,206,235)",
  "slateblue": "rgb(106,90,205)",
  "slategray": "rgb(112,128,144)",
  "slategrey": "rgb(112,128,144)",
  "snow": "rgb(255,250,250)",
  "springgreen": "rgb(0,255,127)",
  "steelblue": "rgb(70,130,180)",
  "tan": "rgb(210,180,140)",
  "teal": "rgb(0,128,128)",
  "thistle": "rgb(216,191,216)",
  "tomato": "rgb(255,99,71)",
  "transparent": "transparent",
  "turquoise": "rgb(64,224,208)",
  "violet": "rgb(238,130,238)",
  "wheat": "rgb(245,222,179)",
  "white": "rgb(255,255,255)",
  "whitesmoke": "rgb(245,245,245)",
  "yellow": "rgb(255,255,0)",
  "yellowgreen": "rgb(154,205,50)"
};