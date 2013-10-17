def = require("./def.js");
eval(def.consts);

if (!Array.prototype.map) {
    Array.prototype.map = function(callback, thisArg) {
        var T, A, k;
        if (this == null) {
            throw new TypeError(" this is null or not defined");
        }
        var O = Object(this);
        var len = O.length >>> 0;
        if (typeof callback !== "function") {
            throw new TypeError(callback + " is not a function");
        }
        if (thisArg) {
            T = thisArg;
        }
        A = new Array(len);
        k = 0;
        while(k < len) {
            var kValue, mappedValue;
            if (k in O) {
                kValue = O[ k ];
                mappedValue = callback.call(T, kValue, k, O);
                A[ k ] = mappedValue;
            }
            k++;
        }
        return A;
    };      
}
Array.prototype.mapEach = Array.prototype.map;

/************* integer **************/
function intLiteral(v,x) {
    if (!(x === undefined)) { 
        for (key in x) {
            if (!(x[key] === undefined)) {
                this[key] = x[key];
            }
        }
    }
    this.type = INTLITERAL;
    this.value = v;
}
intLiteral.prototype.plus = function(b) {
    return intLiteral(this.value + b.value);
}
intLiteral.prototype.minus = function(b) {
    return intLiteral(this.value - b.value);
}
intLiteral.prototype.eq = function() {
    return intLiteral(this.value == b.value);
}
intLiteral.prototype.ne = function() {
    return intLiteral(this.value != b.value);
}
intLiteral.prototype.or = function() {
    return intLiteral(this.value | b.value);
}

function ArrayType() {
    
}

/******* flatten left side select tree of a "v(0 to 1) := v1 & v2; " ********/

Node.prototype._flatselect = function(a) {
    switch(this.type) {
    case RANGEEXPRESSION:
    case IDENTIFIER:
        a.push(this);
        break;
    case SLICEEXPRESSION:
        this.object._flatselect(a);
        this.range._flatselect(a);
        break;
    case INDEXEXPRESSION:
        this.object._flatselect(a);
        this.indexes.mapEach(function (e) { e._flatselect(a) });
        break;
    }
    return a;
}
Node.prototype.flatselect = function() {
    var r = copy({type:SELECT,indexes:[],_unflat:this},{});
    this._flatselect(r['indexes']);
    var id = r['indexes'].shift();
    r['object'] = id;
    return r;
}

/******* flatten right side concat tree of a "v(0 to 1) := v1 & v2; " ********/

Node.prototype._flatappend = function(a) {
    switch(this.type) {
    case BINARYEXPRESSION:
        if ( this.operator == CONCAT) {
            this.left._flatappend(a);
            this.right._flatappend(a);
            break;
        }
    default:
        a.push(this);
        break;
    }
    return a;
}
Node.prototype.flatappend = function() {
    var r = copy({type:APPEND,elements:[],_unflat:this},{});
    this._flatappend(r['elements']);
    return r;
}

/******** Symbols **********/

function Symbol(s, d) {
    if ((this.up = s)) {
        this.name = s.name;
    }
    this.assignements = [];
    this.definition = d;
    /* each symbol has a seperate incarnations for each id-then-else block, 
     * Ctx.cpath depicts the current clause */
    this.cases = {};  /* type Scope */
}

function SymbolCase(s,c) {
    this.sym = s;
    this.case = c;
    this.next = undefined;
    this.blocks = [];
}

SymbolCase.prototype.ofCaseBlock = function(s,c,d,gen) {
    var sym;
    if (!(sym = this.blocks[c.block]) && gen) {
        this.blocks[c.block] = (sym = new Symbol(s, d));
    }
    return sym;
}

function SymbolAssign(s,from,to) {
    this.symbol = s;
    this.next = undefined;
    this.slice = from;
    this.value = to;
}

Symbol.prototype.assign = function(a,b) {
    this.assignements.push(new SymbolAssign(this, a, b));
}

Symbol.prototype.ofCase = function(c, d, gen) {
    var sc;
    if (!(sc = this.cases[c.id]) && gen) {
        this.cases[c.id] = (sc = new SymbolCase(this, c, this));
        this.assignements.push(sc);
    }
    return (!sc) ? unedfined : sc.ofCaseBlock(this,c,d,gen);
}

/******** Scope chain **********/

function Scope(a) {
    this.object = {};
    copyTo(this, a);
}

Scope.prototype.bind = function(n,s) {
    this.object[n] = s;
    s.name = n;
}

Scope.prototype.getSym = function(name) {
    for (s = this; s; s = s.parent) {
        if (name in s.object)
            break;
    }
    return (!s) ? undefined : s.object[name];
}

/******** fold CTX **********/
function Ctx(s) {
    this.scope = s;
    this.block = undefined;
    this.cpath = [];
}

Ctx.prototype.pushScope = function(s) {
    if (s === undefined) {
        s = new Scope({parent:undefined});
    }
    var l = s;
    while (!(l.parent === undefined)) {
        l = l.parent;
    }
    l.parent = this.scope;
    this.scope = s;
    return s;
}

Ctx.prototype.popScope = function(s) {
    var s = this.scope;
    this.scope = this.scope.parent;
    return s;
}

var caseId = 0;
function Case(s) {
    this.id = caseId++;
    this.block = 0;
}

Ctx.prototype.openCase = function(s) {
    this.cpath.push(new Case());
}

Ctx.prototype.closeCase = function(s) {
    return this.cpath.pop();
}

Ctx.prototype.nextCaseBlock = function(s) {
    var c = this.cpath.pop();
    c.block += 1;
    this.cpath.push(c);
}

Ctx.prototype.getSym = function(name, d, gen) {
    var i, j, c, idx, s, cur, nxt;
    sym = this.scope.getSym(name);
    if (!(cur = sym)) {
        return undefined;
    }
    for (i = 0, j = this.cpath.length; cur && i < j; i++) {
        c = this.cpath[i];
        nxt = cur.ofCase(c, d, gen);
        cur = nxt;
    }
    return cur;
}

/******************************/

function Reference(base, propertyName, node, isarr) {
    this.base = base;
    this.propertyName = propertyName;
    this.node = node;
    this.isarr = isarr;
    this.next = undefined;
}

/*
 * v(0 to 1) := v1(0) & v2(0);
 */
function getValue (v) {
    if (v instanceof Reference) {
        return v.base[v.propertyName];
    }
    return v;
};

function putValue (v, w) {
    if (v instanceof Reference) {
        return v.base[v.propertyName] = w;
    }
};

function Node(n) {
    this.next = undefined;
}

function copy(d,x) {
    var r = new Node(), key;
    for (key in d) {
        if (!(key in x)) {
            if (!(d[key] === undefined)) {
                r[key] = d[key];
            }
        }
    }
    for (key in x) {
        if (!(x[key] === undefined)) {
            r[key] = x[key];
        }
    }
    r['_copy'] = d;
    return r;
}

function definedVar(s, name, typ) {
}

function getRef(s, name, d) {
    
}

function vals(array) {
    
    return 0;
}

function fold(a) {
    
}

fold.prototype = {
    'ARCHITECTURE': function (d,x) {
        var df, pf, s;
        s = x.pushScope();
        try {
            df = d.decls.mapEach(function (e) { return this[foldFor(e)](e, x); }, this);
            pf = d.procs.mapEach(function (e) { return this[foldFor(e)](e, x); }, this);
            return copy(d, {
                decls: df,
                procs: pf,
                _scope: s
            });
        } finally {
            x.popScope();
        }
    },
    'PROCESS' : function (d,x) {
        var df, bf, s;
        s = x.pushScope();
        try {
            df = d.decls.mapEach(function (e) { return this[foldFor(e)](e, x); }, this);
            bf = d.block.mapEach(function (e) { return this[foldFor(e)](e, x); }, this);
            return copy(d, {
                decls: df, 
                block: bf,
                _scope: s
            });
        } finally {
            x.popScope();
        }
    },        
    'PACKAGE' : function (d,x) {
        return copy(d, {
            decls: d.decls.mapEach(function (e) { return this[foldFor(e)](e, x); }, this),
            procs: d.procs.mapEach(function (e) { return this[foldFor(e)](e, x); }, this) });
    },
    'ENTITY' : function (d,x) {
        return copy(d, { 
            generics: d.generics.mapEach(function (e) { return this[foldFor(e)](e, x); }, this), 
            ports   : d.ports.mapEach(   function (e) { return this[foldFor(e)](e, x); }, this) });
    },
    'COMPONENT' : function (d,x) {
        return copy(d, { 
            generics: d.generics.mapEach(function (e) { return this[foldFor(e)](e, x); }, this), 
            ports   : d.ports.mapEach(   function (e) { return this[foldFor(e)](e, x); }, this) });
    }, 
    'SIGNAL' : function (d,x) {
        return copy(d, { 
            typdef: this.fold(d.typdef, x) });
    },
    'PACKAGE' : function (d,x) {
        return copy(d, {
            decls: d.decls.mapEach(function (e) { return this[foldFor(e)](e, x); }, this),
            procs: d.procs.mapEach(function (e) { return this[foldFor(e)](e, x); }, this) });
    },
    'ENTITY' : function (d,x) {
        return copy(d, { 
            generics: d.generics.mapEach(function (e) { return this[foldFor(e)](e, x); }, this), 
            ports   : d.ports.mapEach(   function (e) { return this[foldFor(e)](e, x); }, this) });
    }, 
    'COMPONENT': function (d,x) {
        return copy(d, { 
            generics: d.generics.mapEach(function (e) { return this[foldFor(e)](e, x); }, this), 
            ports   : d.ports.mapEach(   function (e) { return this[foldFor(e)](e, x); }, this) });
    },
    'SIGNAL' : function (d,x) {
        return copy(d, { 
            typdef: this[foldFor(d.typdef)](d.typdef, x) });
    },
    'TYPECONSTRAINEDARRAY' : function (d,x) {
        return copy(d, { 
            range: this[foldFor(d.range)](d.range, x) });
    },
    'WAVEFORM' : function (d,x) { return copy(d, {}); },
    'TYPEENUM' : function (d,x) { return copy(d, {}); },
    'INTLITERAL' : function (d,x) { return copy(d, {}); },
    'ENUMLITERAL' : function (d,x) { return copy(d, {}); },
    'STRINGLITERAL' : function (d,x) { return copy(d, {}); },
    'IDENTIFIER' : function (d,x) { return copy(d, { }); },
    
    'BLOCKSTATEMENT' : function (d,x) {
        return copy(d, { body: d.body.mapEach(function (e) { return this[foldFor(e)](e, x); }, this) });
    },
        
    'IFSTATEMENT' : function(d, x) {
        var isv, av, bv, c, a, t, cf, af, cid;
        t = d.test;
        c = d.consequence;
        a = d.alternate;
        isv = vals(t = this[foldFor(t)](t, x));
        if (isv) {
            av = getValue(isv);
            return av.istrue() ? 
                this[foldFor(c)](c, x) : 
                this[foldFor(a)](a, x);
        } else {
            
            x.openCase();
            try {
                cf = this[foldFor(c)](c, x);
                x.nextCaseBlock();
                af = this[foldFor(a)](a, x);
                x.nextCaseBlock();
                return copy(d, {
                    consequence : cf, 
                    alternate   : af});
            } finally {
                x.closeCase();
            }
        }
    },
    
    'VAR' : function (d,x) {
        var tf, t, v, i, s;
        t = d.typedef;
        i = d.initializer;
        tf = this[foldFor(t)](t, x);
        
        s = new Symbol(null, d);
        x.scope.bind(d.name, s);
        
        /*definedVar(x.scope, d.name, tf);*/
        
        v = this[foldFor(i)](i, x);
        return copy(d, { 
            typedef : tf,
            initializer: v
        });
    }, 

    'SLICEEXPRESSION' : function (d,x) {
        var o, r;
        o = d.object;
        r = d.range;
        return copy(d, {
            object  : this[foldFor(o)](o, x),
            range  : this[foldFor(r)](r, x) });
    },
    'INDEXEXPRESSION' : function (d,x) {
        var o;
        o = d.object;
        return copy(d, {
            object  : this[foldFor(o)](o, x),
            indexes : d.indexes.mapEach(function (e) { return this[foldFor(e)](e, x); }, this)});
    },
    
    'ASSIGNMENTEXPRESSIONVAR' : function (d,x) {
        var l, r, av, a, b, al, bl, id, c;
        l = d.left;
        r = d.right;
        a = this[foldFor(l)](l, x);
        b = this[foldFor(r)](r, x);
        al = a.flatselect();
        id = al['object'];
        bl = b.flatappend();
        
        c =  copy(d, { 
            left : al,
            right: bl });
        
        switch(id['type']) {
        case IDENTIFIER:
            sym = x.getSym(id['value'], d, 1); /* instantiate symbol in clause-tree if not present */
            if (sym === undefined) {
                throw new TypeError(" Symbol '" + id['value'] + "' not found");
            }
            sym.assign(al, bl);
            break;
        default:
            throw new TypeError(defs.tokens[id.type] + " : Not implemented");
        };
        
        return c;
    },
    
    'ASSIGNMENTEXPRESSIONSIG' : function (d,x) {
        var l, r, a, b;
        l = d.left;
        r = d.right;
        a = this[foldFor(l)](l, x);
        b = r.mapEach(function (e) { return this[foldFor(e)](e, x); }, this);
        av = getValue(a);
        
        return copy(d, {
            left : a,
            right: b });
    }, 

    'RANGEEXPRESSION' : function (d,x) {
        return copy(d, { 
            left: this[foldFor(d.left)](d.left,  x),
            right: this[foldFor(d.right)](d.right,  x)
        });
    },
    
    'BINARYEXPRESSION' : function (d,x) {
        var l, r, av, bv, a, b;
        l = d.left;
        r = d.right;
        av = getValue(a = this[foldFor(l)](l , x));
        bv = getValue(b = this[foldFor(r)](r, x));
        if (!vals(av, bv)) {
            return copy(d, {left:a, right:b});
        }
        switch(d.op) {
        case PLUS:
            return av.plus(bv);
        case OR:
            return av.or(bv);
        case MINUS:
            return av.minus(bv);
        case EQ:
            return av.eq(bv);
        case NE:
            return av.ne(bv);
        }
    }, 
    
    'UNARYEXPRESSION' : function (d,x) {
        var l;
        l = d.left;
        av = getValue(a = this[foldFor(l)](l , x));
        if (!vals(av)) {
            return copy(d, {left:a});
        }
        switch(d.op) {
        case NOT:
            return av.not(bv);
        }
    },
    
    'NOP' : function (d,x) {
        return undefined;
    },
    
    fold:  function (d,x) { return this[foldFor(d)](d, x); }
    
};

function foldFor(a) { 
    if (a === undefined) { return "NOP"; };
    return defs.tokens[a.type]; 
}

function copyTo(a,b) {
    if (!(b === undefined)) {
        for (key in b) {
            if (!(b[key] === undefined)) {
                a[key] = b[key];
            }
        }
    }
}

exports.fold = fold;
exports.Scope = Scope;
exports.Ctx = Ctx;

/*
  Local Variables:
  c-basic-offset:4
  indent-tabs-mode:nil
  End:
*/
