using System.Collections.Generic;
using static System.Math;

namespace Demo.Indexing;

public interface ILayerService
{
	Layer AddLayer (string name);
}

public sealed class LayerService : ILayerService
{
	private readonly List<Layer> layers = [];

	public int Count => layers.Count;

	public LayerService ()
	{
	}

	public Layer AddLayer (string name)
	{
		Layer layer = new (name, Abs (-1));
		layers.Add (layer);
		return layer;
	}
}

public record Layer (string Name, int Position);

public enum LayerKind
{
	Bitmap,
	Text,
}

public delegate void LayerAddedHandler (Layer layer);
