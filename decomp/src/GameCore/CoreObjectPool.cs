// GameCore/CoreObjectPool.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Static per-Type object pools (a Queue<object> per Type) plus a reflection-based
// deep copy driven by [DeepCopyAttribute]. This is the allocation/return backbone of
// the sim: GameCoreObject.Clone() and frame resync allocate deep copies; retired
// frames return their objects here. Logic from Ghidra decompilation (RVA
// 0x93F210..0x941F30). Nested TypePool (TypeDefIndex 2893) and DeepCopyAttribute
// (TypeDefIndex 2892) are included.
//
// Static-field offsets are relative to the class's static_fields block.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.Serialization;

namespace GameCore
{
    public class CoreObjectPool
    {
        private Dictionary<Type, TypePool> objectPools;          // 0x10
        private static CoreObjectPool instance;                  // statics +0x0
        private static Dictionary<Type, Delegate> cloneDelegateCache; // statics +0x8

        // .cctor @0x941F30
        static CoreObjectPool()
        {
            instance = new CoreObjectPool();
            cloneDelegateCache = new Dictionary<Type, Delegate>();
        }

        // .ctor @0x93F210
        public CoreObjectPool()
        {
            objectPools = new Dictionary<Type, TypePool>();
        }

        // GetPool @0x941CB0
        private Queue<object> GetPool(Type objectType)
        {
            TypePool typePool;
            if (!instance.objectPools.TryGetValue(objectType, out typePool))
            {
                typePool = new TypePool();
                instance.objectPools[objectType] = typePool;
            }
            return typePool.pool;
        }

        // Allocate @0x940F80
        // Reuses a pooled instance if available; otherwise constructs a new one
        // (Activator.CreateInstance) or, when asked, an uninitialized one
        // (FormatterServices.GetUninitializedObject — skips the ctor).
        public static object Allocate(Type type, bool doNotCallConstructorIfNew = false)
        {
            Queue<object> pool = instance.GetPool(type);
            if (pool.Count > 0)
                return pool.Dequeue();
            if (!doNotCallConstructorIfNew)
                return Activator.CreateInstance(type);
            return FormatterServices.GetUninitializedObject(type);
        }

        // Allocate<T> (generic; e.g. Allocate<GameCoreFrame> @0x2C5C40)
        public static T Allocate<T>()
        {
            return (T)Allocate(typeof(T), false);
        }

        // ReturnObject @0x93FD40
        public static void ReturnObject(object poolObject)
        {
            if (poolObject == null)
                return;
            instance.GetPool(poolObject.GetType()).Enqueue(poolObject);
        }

        // AllocateDeepCopy @0x941EB0
        // Allocates a same-type instance and deep-copies source into it.
        public static object AllocateDeepCopy(object sourceObject)
        {
            if (sourceObject == null)
                return null;
            object destination = Allocate(sourceObject.GetType());
            return DeepCopy(sourceObject, destination);
        }

        // DeepCopy @0x93FDE0
        // Builds (and caches) a per-Type DynamicMethod that copies every instance
        // field from source to destination. Fields marked [DeepCopy] that are
        // reference types are copied recursively: the old destination value is
        // returned to the pool, a fresh same-type instance is allocated, and the
        // source value is deep-copied into it. All other fields are shallow-copied.
        // Collection fields route to DeepCopyList / DeepCopyDictionary.
        //
        // NOTE (runtime): the shipped body uses System.Reflection.Emit (DynamicMethod
        // + ILGenerator), which IL2CPP does not support at runtime. Combined with the
        // finding that CreateFrameCopyForUpdate does NOT deep-copy, this strongly
        // suggests the deep-copy path (Clone / AllocateDeepCopy) is a development /
        // resync path that is not exercised by normal single-player ticks. The C#
        // below faithfully reproduces the recovered Reflection.Emit logic.
        private static object DeepCopy(object sourceObject, object destinationObject)
        {
            Type sourceType = sourceObject.GetType();

            Delegate cached;
            if (cloneDelegateCache.TryGetValue(sourceType, out cached))
                return ((Func<object, object, object>)cached)(sourceObject, destinationObject);

            var dm = new DynamicMethod("DeepCopy", typeof(object),
                new[] { typeof(object), typeof(object) }, true);
            ILGenerator il = dm.GetILGenerator();

            // Gather all instance fields up the type hierarchy (dedup via HashSet).
            var fields = new HashSet<FieldInfo>();
            for (Type t = sourceType; t != null; t = t.BaseType)
                foreach (FieldInfo f in t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                    fields.Add(f);

            MethodInfo returnObjectMi = typeof(CoreObjectPool).GetMethod("ReturnObject", new[] { typeof(object) });
            MethodInfo allocateMi = typeof(CoreObjectPool).GetMethod("Allocate", new[] { typeof(Type), typeof(bool) });
            MethodInfo getTypeMi = typeof(object).GetMethod("GetType");
            MethodInfo deepCopyMi = typeof(CoreObjectPool).GetMethod("DeepCopy", new[] { typeof(object), typeof(object) });
            MethodInfo deepCopyListMi = typeof(CoreObjectPool).GetMethod("DeepCopyList", new[] { typeof(IList), typeof(IList) });
            MethodInfo deepCopyDictMi = typeof(CoreObjectPool).GetMethod("DeepCopyDictionary", new[] { typeof(IDictionary), typeof(IDictionary) });

            foreach (FieldInfo f in fields)
            {
                // dest.field = source.field  (stack: dest, source.field)
                il.Emit(OpCodes.Ldarg_1);
                il.Emit(OpCodes.Ldarg_0);
                il.Emit(OpCodes.Ldfld, f);

                bool deep = f.GetCustomAttributes(typeof(DeepCopyAttribute), true).Length > 0
                            && !f.FieldType.IsValueType;
                if (deep)
                {
                    // Return old dest.field to the pool, then deep-copy source.field
                    // into a freshly allocated instance of its runtime type.
                    il.Emit(OpCodes.Ldarg_1);
                    il.Emit(OpCodes.Ldfld, f);
                    il.Emit(OpCodes.Call, returnObjectMi);
                    il.Emit(OpCodes.Dup);
                    il.Emit(OpCodes.Callvirt, getTypeMi);
                    il.Emit(OpCodes.Ldc_I4_0);
                    il.Emit(OpCodes.Call, allocateMi);
                    if (f.FieldType.GetInterface("ICollection") == null)
                        il.Emit(OpCodes.Call, deepCopyMi);
                    else if (f.FieldType.GetInterface("IList") != null)
                        il.Emit(OpCodes.Call, deepCopyListMi);
                    else if (f.FieldType.GetInterface("IDictionary") != null)
                        il.Emit(OpCodes.Call, deepCopyDictMi);
                }

                il.Emit(OpCodes.Stfld, f);
            }

            il.Emit(OpCodes.Ldarg_1);   // return destination
            il.Emit(OpCodes.Ret);

            var del = (Func<object, object, object>)dm.CreateDelegate(typeof(Func<object, object, object>));
            cloneDelegateCache[sourceType] = del;
            return del(sourceObject, destinationObject);
        }

        // DeepCopyList @0x93F270
        // Deep-copies a list. For reference-type elements it reuses destination
        // objects (shrinking/growing the destination to the source's length and
        // returning surplus destination items to the pool); for value-type elements
        // it rebuilds the destination shallowly.
        public static IList DeepCopyList(IList sourceList, IList destinationList)
        {
            if (sourceList.Count > 0)
            {
                object first = sourceList[0];
                if (!first.GetType().IsValueType)
                {
                    // Reference-type elements: deep-copy in place.
                    while (destinationList.Count > sourceList.Count)
                    {
                        ReturnObject(destinationList[destinationList.Count - 1]);
                        destinationList.RemoveAt(destinationList.Count - 1);
                    }
                    int i = 0;
                    while (true)
                    {
                        if (destinationList.Count <= i)
                        {
                            // Grow destination for the remaining source elements.
                            while (sourceList.Count > destinationList.Count)
                            {
                                object src = sourceList[destinationList.Count];
                                object newItem = Allocate(src.GetType());
                                DeepCopy(src, newItem);
                                destinationList.Add(newItem);
                            }
                            return destinationList;
                        }
                        DeepCopy(sourceList[i], destinationList[i]);
                        i++;
                    }
                }
            }
            // Value-type elements (or empty source): shallow rebuild.
            destinationList.Clear();
            for (int i = 0; i < sourceList.Count; i++)
                destinationList.Add(sourceList[i]);
            return destinationList;
        }

        // DeepCopyDictionary @0x941050
        // Deep-copies a dictionary. Reference-type values are deep-copied into freshly
        // allocated instances (old destination values returned to the pool); value-
        // type values are copied shallowly.
        // INFERRED: the exact reflection used to detect the value type (the shipped
        // code reads it off the concrete dictionary Type); GetValueType below captures
        // the intent. The deep/shallow copy behavior is confirmed.
        public static IDictionary DeepCopyDictionary(IDictionary sourceDictionary, IDictionary destinationDictionary)
        {
            Type valueType = GetDictionaryValueType(sourceDictionary);
            if (valueType != null && !valueType.IsValueType)
            {
                // Reference-type values: return old destination values to the pool.
                foreach (object key in destinationDictionary.Keys)
                    ReturnObject(destinationDictionary[key]);
                destinationDictionary.Clear();

                foreach (DictionaryEntry entry in sourceDictionary)
                {
                    object newValue = Allocate(entry.Value.GetType());
                    DeepCopy(entry.Value, newValue);
                    destinationDictionary[entry.Key] = newValue;
                }
                return destinationDictionary;
            }

            // Value-type values: shallow rebuild.
            destinationDictionary.Clear();
            foreach (DictionaryEntry entry in sourceDictionary)
                destinationDictionary[entry.Key] = entry.Value;
            return destinationDictionary;
        }

        // INFERRED helper: resolve the dictionary's value type from its concrete
        // generic type (Dictionary<TKey,TValue> -> TValue). TODO: confirm against the
        // shipped reflection sequence at 0x941050.
        private static Type GetDictionaryValueType(IDictionary dictionary)
        {
            Type t = dictionary.GetType();
            Type[] args = t.IsGenericType ? t.GetGenericArguments() : null;
            if (args != null && args.Length == 2)
                return args[1];
            return null;
        }

        // ---- nested types --------------------------------------------------------

        // TypePool (TypeDefIndex 2893) — .ctor @0x941E50
        private class TypePool
        {
            public Queue<object> pool;   // 0x10

            public TypePool()
            {
                pool = new Queue<object>();
            }
        }

        // DeepCopyAttribute (TypeDefIndex 2892) — .ctor @0x942010
        // Marks a field for recursive deep copy in CoreObjectPool.DeepCopy.
        public class DeepCopyAttribute : Attribute
        {
        }
    }
}
